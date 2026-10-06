import {
  ChannelType,
  EmbedBuilder,
  type NewsChannel,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type TextChannel,
} from 'discord.js';
import { welcomeService } from '../welcome/store.js';

export const welcomeCommand = {
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure automatic welcome messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName('setup')
      .setDescription('Configure the welcome channel and message.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('The channel where welcome messages will be sent.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true))
      .addStringOption((option) => option
        .setName('message')
        .setDescription('Use {user}, {username}, {server}, or {membercount}.')
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('disable')
      .setDescription('Disable automatic welcome messages.'))
    .addSubcommand((subcommand) => subcommand
      .setName('channel')
      .setDescription('Change the welcome channel.')
      .addChannelOption((option) => option
        .setName('channel')
        .setDescription('The channel where welcome messages will be sent.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('message')
      .setDescription('Change the welcome message.')
      .addStringOption((option) => option
        .setName('message')
        .setDescription('Use {user}, {username}, {server}, or {membercount}.')
        .setRequired(true))),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'The /welcome command can only be used inside a Discord server.', ephemeral: true });
      return;
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'You need Manage Server permission to configure welcome messages.', ephemeral: true });
      return;
    }

    const subcommand = interaction.options.getSubcommand();
    const existing = await welcomeService.get(interaction.guild.id);

    if (subcommand === 'disable') {
      if (existing) await welcomeService.save({ ...existing, enabled: false });
      await interaction.reply({ content: 'Automatic welcome messages are disabled.', ephemeral: true });
      return;
    }

    if (subcommand === 'setup') {
      const channel = interaction.options.getChannel('channel', true);
      const message = interaction.options.getString('message', true).trim();
      if (!isWelcomeChannel(channel)) {
        await interaction.reply({ content: 'Choose a text-based channel that can receive messages.', ephemeral: true });
        return;
      }
      const missingPermissions = await getMissingChannelPermissions(interaction, channel);
      if (missingPermissions.length > 0) {
        await interaction.reply({ content: `ServerPilot cannot send welcome embeds there. Missing: ${missingPermissions.join(', ')}.`, ephemeral: true });
        return;
      }
      if (!message) {
        await interaction.reply({ content: 'The welcome message cannot be empty.', ephemeral: true });
        return;
      }
      await welcomeService.save({ guildId: interaction.guild.id, channelId: channel.id, message, enabled: true });
      await interaction.reply({ content: `Welcome messages are enabled in <#${channel.id}>.`, ephemeral: true });
      return;
    }

    if (!existing) {
      await interaction.reply({ content: 'Welcome messages are not configured yet. Use `/welcome setup` first.', ephemeral: true });
      return;
    }

    if (subcommand === 'channel') {
      const channel = interaction.options.getChannel('channel', true);
      if (!isWelcomeChannel(channel)) {
        await interaction.reply({ content: 'Choose a text-based channel that can receive messages.', ephemeral: true });
        return;
      }
      const missingPermissions = await getMissingChannelPermissions(interaction, channel);
      if (missingPermissions.length > 0) {
        await interaction.reply({ content: `ServerPilot cannot send welcome embeds there. Missing: ${missingPermissions.join(', ')}.`, ephemeral: true });
        return;
      }
      await welcomeService.save({ ...existing, channelId: channel.id, enabled: true });
      await interaction.reply({ content: `Welcome messages will now be sent in <#${channel.id}>.`, ephemeral: true });
      return;
    }

    if (!existing.channelId) {
      await interaction.reply({ content: 'Welcome messages are not fully configured yet. Use `/welcome setup` first.', ephemeral: true });
      return;
    }
    const message = interaction.options.getString('message', true).trim();
    if (!message) {
      await interaction.reply({ content: 'The welcome message cannot be empty.', ephemeral: true });
      return;
    }
    await welcomeService.save({ ...existing, message, enabled: true });
    await interaction.reply({ content: 'The welcome message has been updated and enabled.', ephemeral: true });
  },
};

function isWelcomeChannel(channel: ReturnType<ChatInputCommandInteraction['options']['getChannel']>): channel is TextChannel | NewsChannel {
  return channel !== null && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement);
}

async function getMissingChannelPermissions(interaction: ChatInputCommandInteraction, channel: TextChannel | NewsChannel) {
  const botMember = await interaction.guild?.members.fetchMe();
  if (!botMember) return ['View Channels', 'Send Messages'];
  const permissions = channel.permissionsFor(botMember);
  if (!permissions) return ['View Channels', 'Send Messages'];

  const requiredPermissions: Array<[bigint, string]> = [
    [PermissionFlagsBits.ViewChannel, 'View Channels'],
    [PermissionFlagsBits.SendMessages, 'Send Messages'],
    [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  ];
  return requiredPermissions.filter(([permission]) => !permissions.has(permission)).map(([, name]) => name);
}

function renderWelcomeMessage(message: string, member: GuildMember) {
  return message
    .replaceAll('{user}', `<@${member.id}>`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', member.guild.memberCount.toLocaleString());
}

export async function sendWelcomeMessage(member: GuildMember) {
  const configuration = await welcomeService.get(member.guild.id);
  if (!configuration?.enabled || !configuration.channelId) return;

  const channel = await member.guild.channels.fetch(configuration.channelId).catch(() => undefined);
  if (!channel || !isWelcomeChannel(channel)) return;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`Welcome to ${member.guild.name}!`)
    .setDescription(renderWelcomeMessage(configuration.message, member))
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: 'ServerPilot Welcome' })
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => undefined);
}
