import {
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { automationEngine } from '../automation/engine.js';
import { getWarningCount, recordWarning } from '../automation/warnings.js';
import { moderationService } from '../moderation/store.js';

const timeoutLimitMinutes = 28 * 24 * 60;
const moderationLogChannels = new Map<string, string>();
export { getWarningCount } from '../automation/warnings.js';

function buildModerationCommand(name: 'warn' | 'timeout' | 'kick' | 'ban', description: string, permission: bigint) {
  const command = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addUserOption((option) => option.setName('member').setDescription('The member to moderate.').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Why this action is being taken.').setRequired(true));

  if (name === 'timeout') {
    command.addIntegerOption((option) => option
      .setName('duration')
      .setDescription('Timeout duration in minutes, up to 28 days.')
      .setMinValue(1)
      .setMaxValue(timeoutLimitMinutes)
      .setRequired(true));
  }

  return command.setDefaultMemberPermissions(permission);
}

export const warnCommand = {
  data: buildModerationCommand('warn', 'Warn a server member.', PermissionFlagsBits.ModerateMembers),
  async execute(interaction: ChatInputCommandInteraction) {
    await executeModeration(interaction, 'warn');
  },
};

export const timeoutCommand = {
  data: buildModerationCommand('timeout', 'Temporarily timeout a server member.', PermissionFlagsBits.ModerateMembers),
  async execute(interaction: ChatInputCommandInteraction) {
    await executeModeration(interaction, 'timeout');
  },
};

export const kickCommand = {
  data: buildModerationCommand('kick', 'Kick a server member.', PermissionFlagsBits.KickMembers),
  async execute(interaction: ChatInputCommandInteraction) {
    await executeModeration(interaction, 'kick');
  },
};

export const banCommand = {
  data: buildModerationCommand('ban', 'Ban a server member.', PermissionFlagsBits.BanMembers),
  async execute(interaction: ChatInputCommandInteraction) {
    await executeModeration(interaction, 'ban');
  },
};

export const moderationCommand = {
  data: new SlashCommandBuilder()
    .setName('moderation')
    .setDescription('Configure ServerPilot moderation settings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('log-channel')
      .setDescription('Set the channel where moderation actions are logged.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('A text channel for moderation logs.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'This command can only be used inside a Discord server.', ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'You need Manage Server permission to configure moderation.', ephemeral: true });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({ content: 'Moderation logs must use a text channel.', ephemeral: true });
      return;
    }

    moderationLogChannels.set(interaction.guild.id, channel.id);
    await interaction.reply({ content: `Moderation actions will be logged in <#${channel.id}>.`, ephemeral: true });
  },
};

function getPermissionForAction(action: 'warn' | 'timeout' | 'kick' | 'ban') {
  return action === 'kick' ? PermissionFlagsBits.KickMembers
    : action === 'ban' ? PermissionFlagsBits.BanMembers
      : PermissionFlagsBits.ModerateMembers;
}

function getActionLabel(action: 'warn' | 'timeout' | 'kick' | 'ban') {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

async function getTargetMember(interaction: ChatInputCommandInteraction) {
  const user = interaction.options.getUser('member', true);
  try {
    return await interaction.guild?.members.fetch(user.id);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10007) {
      return undefined;
    }
    throw error;
  }
}

function canModerate(moderator: GuildMember, target: GuildMember, action: 'warn' | 'timeout' | 'kick' | 'ban') {
  if (target.id === moderator.id) return 'You cannot moderate yourself.';
  if (target.id === moderator.guild.ownerId) return 'The server owner cannot be moderated.';
  if (target.id === moderator.client.user?.id) return 'ServerPilot cannot moderate itself.';
  if (target.roles.highest.position >= moderator.roles.highest.position) return 'You cannot moderate a member with an equal or higher role.';
  if (action === 'warn') return undefined;

  const canBotPerformAction = action === 'kick' ? target.kickable
    : action === 'ban' ? target.bannable
      : target.moderatable;
  if (!canBotPerformAction) return 'ServerPilot cannot moderate this member because of Discord permissions or role hierarchy.';
  return undefined;
}

async function executeModeration(interaction: ChatInputCommandInteraction, action: 'warn' | 'timeout' | 'kick' | 'ban') {
  if (!interaction.guild) {
    await interaction.reply({ content: `The /${action} command can only be used inside a Discord server.`, ephemeral: true });
    return;
  }

  const permission = getPermissionForAction(action);
  if (!interaction.memberPermissions?.has(permission)) {
    await interaction.reply({ content: `You need the ${permission === PermissionFlagsBits.KickMembers ? 'Kick Members' : permission === PermissionFlagsBits.BanMembers ? 'Ban Members' : 'Moderate Members'} permission to use /${action}.`, ephemeral: true });
    return;
  }

  const reason = interaction.options.getString('reason', true).trim();
  if (!reason) {
    await interaction.reply({ content: 'A non-empty reason is required.', ephemeral: true });
    return;
  }

  const durationMinutes = action === 'timeout' ? interaction.options.getInteger('duration', true) : undefined;
  if (durationMinutes !== undefined && (durationMinutes < 1 || durationMinutes > timeoutLimitMinutes)) {
    await interaction.reply({ content: 'Timeout duration must be between 1 minute and 28 days.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  let actionApplied = false;
  try {
    const target = await getTargetMember(interaction);
    const moderator = await interaction.guild.members.fetch(interaction.user.id);
    if (!target) {
      await interaction.editReply('That member is not in this server.');
      return;
    }

    const hierarchyError = canModerate(moderator, target, action);
    if (hierarchyError) {
      await interaction.editReply(hierarchyError);
      return;
    }

    if (action !== 'warn') {
      const botMember = await interaction.guild.members.fetchMe();
      if (!botMember.permissions.has(permission)) {
        await interaction.editReply(`ServerPilot is missing the required ${action === 'kick' ? 'Kick Members' : action === 'ban' ? 'Ban Members' : 'Moderate Members'} permission.`);
        return;
      }
    }

    if (action === 'timeout' && target.communicationDisabledUntilTimestamp && target.communicationDisabledUntilTimestamp > Date.now()) {
      await interaction.editReply('That member is already timed out. Wait for the current timeout to expire before applying another.');
      return;
    }

    if (action === 'warn') {
      const count = recordWarning(interaction.guild.id, target.id, moderator.id, reason);
      actionApplied = true;
      await automationEngine.process({ guildId: interaction.guild.id, type: 'WARNING_ISSUED', client: interaction.client, userId: target.id, member: target, warningCount: count, metadata: { reason } });
    } else if (action === 'timeout' && durationMinutes !== undefined) {
      await target.timeout(durationMinutes * 60 * 1000, reason);
      actionApplied = true;
    } else if (action === 'kick') {
      await target.kick(reason);
      actionApplied = true;
    } else {
      await target.ban({ reason });
      actionApplied = true;
    }

    try {
      await moderationService.record({
        guildId: interaction.guild.id,
        targetUserId: target.id,
        moderatorUserId: moderator.id,
        action,
        reason,
        ...(durationMinutes === undefined ? {} : { durationSeconds: durationMinutes * 60 }),
      });
    } catch (error) {
      console.error('Moderation action succeeded but case persistence failed.', error instanceof Error ? error.name : 'UnknownError');
      await interaction.editReply(`${getActionLabel(action)} was applied to **${target.user.tag}**, but its moderation history could not be saved. Please check database availability.`);
      return;
    }

    await logModerationAction(interaction, action, target, moderator, reason, durationMinutes);
    const durationText = durationMinutes === undefined ? '' : ` for ${durationMinutes} minute${durationMinutes === 1 ? '' : 's'}`;
    await interaction.editReply(`${getActionLabel(action)} applied to **${target.user.tag}**${durationText}.`);
  } catch (error) {
    if (actionApplied) {
      console.error('Moderation action succeeded but a follow-up operation failed.', error instanceof Error ? error.name : 'UnknownError');
      await interaction.editReply(`${getActionLabel(action)} was applied, but ServerPilot could not complete a follow-up operation.`);
      return;
    }
    const detail = error instanceof DiscordAPIError ? ` Discord error ${error.code}.` : '';
    await interaction.editReply(`ServerPilot could not complete that moderation action.${detail}`);
  }
}

async function logModerationAction(
  interaction: ChatInputCommandInteraction,
  action: 'warn' | 'timeout' | 'kick' | 'ban',
  target: GuildMember,
  moderator: GuildMember,
  reason: string,
  durationMinutes?: number,
) {
  const channelId = moderationLogChannels.get(interaction.guild?.id ?? '');
  if (!channelId || !interaction.guild) return;

  const channel = await interaction.guild.channels.fetch(channelId).catch(() => undefined);
  if (!channel || channel.type !== ChannelType.GuildText) return;
  const textChannel = channel as TextChannel;
  const embed = new EmbedBuilder()
    .setColor(action === 'ban' ? 0xed4245 : action === 'kick' ? 0xe67e22 : action === 'timeout' ? 0xf1c40f : 0xf1c40f)
    .setTitle(`Moderation: ${getActionLabel(action)}`)
    .addFields(
      { name: 'Target', value: `${target.user.tag} (${target.id})`, inline: false },
      { name: 'Moderator', value: `${moderator.user.tag} (${moderator.id})`, inline: false },
      { name: 'Reason', value: reason.slice(0, 1024), inline: false },
    )
    .setTimestamp();
  if (durationMinutes !== undefined) embed.addFields({ name: 'Duration', value: `${durationMinutes} minute${durationMinutes === 1 ? '' : 's'}`, inline: true });
  await textChannel.send({ embeds: [embed] }).catch(() => undefined);
}
