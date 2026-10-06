import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Role,
  type TextChannel,
} from 'discord.js';
import { automationEngine } from '../automation/engine.js';
import { ticketConfigurationService, TicketPersistenceError } from '../tickets/store.js';
import { ticketService, TicketRecordPersistenceError, type TicketRecord } from '../tickets/records.js';

const openingTickets = new Set<string>();

const requiredBotPermissions = [
  [PermissionFlagsBits.ViewChannel, 'View Channels'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
] as const;

export const ticketsCommand = {
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Configure and manage support tickets.')
    .addSubcommand((subcommand) => subcommand
      .setName('setup')
      .setDescription('Configure the ticket category, role, logs, and panel.')
      .addChannelOption((option) => option.setName('category').setDescription('Category for private ticket channels.').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
      .addRoleOption((option) => option.setName('support-role').setDescription('Role that can access tickets.').setRequired(true))
      .addChannelOption((option) => option.setName('log-channel').setDescription('Channel for ticket closure logs.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addChannelOption((option) => option.setName('panel-channel').setDescription('Channel where the ticket panel will be posted.').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((subcommand) => subcommand.setName('disable').setDescription('Disable new ticket creation without deleting existing tickets.'))
    .addSubcommand((subcommand) => subcommand.setName('panel').setDescription('Post the ticket panel in the configured channel.'))
    .addSubcommand((subcommand) => subcommand.setName('close').setDescription('Close the ticket channel where this command is used.')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({ content: 'The /tickets command can only be used inside a Discord server.', ephemeral: true });
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand !== 'close' && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: 'You need Manage Server permission to configure tickets.', ephemeral: true });
      return;
    }

    if (subcommand === 'setup') {
      await configureTickets(interaction);
    } else if (subcommand === 'disable') {
      const configuration = await ticketConfigurationService.get(interaction.guild.id);
      if (configuration) await ticketConfigurationService.save({ ...configuration, enabled: false });
      await interaction.reply({ content: 'New ticket creation is disabled. Existing tickets were not changed.', ephemeral: true });
    } else if (subcommand === 'panel') {
      await postTicketPanel(interaction);
    } else {
      await closeTicket(interaction);
    }
  },
};

async function getMissingBotPermissions(guild: Guild) {
  const botMember = await guild.members.fetchMe();
  return requiredBotPermissions
    .filter(([permission]) => !botMember.permissions.has(permission))
    .map(([, name]) => name);
}

function isTextChannel(channel: unknown): channel is TextChannel {
  return Boolean(channel && typeof channel === 'object' && 'type' in channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement));
}

async function configureTickets(interaction: ChatInputCommandInteraction) {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'This command can only be used inside a Discord server.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const missingPermissions = await getMissingBotPermissions(guild);
  if (missingPermissions.length > 0) {
    await interaction.editReply(`ServerPilot needs these permissions before tickets can be configured: ${missingPermissions.join(', ')}.`);
    return;
  }

  const category = interaction.options.getChannel('category', true);
  const supportRole = interaction.options.getRole('support-role', true);
  const logChannel = interaction.options.getChannel('log-channel', true);
  const panelChannel = interaction.options.getChannel('panel-channel', true);
  if (category.type !== ChannelType.GuildCategory || !isTextChannel(logChannel) || !isTextChannel(panelChannel)) {
    await interaction.editReply('Choose a category and valid text channels for logs and the panel.');
    return;
  }

  const botMember = await guild.members.fetchMe();
  const missingChannelPermissions = [
    [logChannel, 'log channel'],
    [panelChannel, 'panel channel'],
  ].flatMap(([channel, label]) => {
    const permissions = (channel as TextChannel).permissionsFor(botMember);
    return permissions && permissions.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])
      ? []
      : [`View Channels, Send Messages, and Embed Links in the ${label}`];
  });
  if (missingChannelPermissions.length > 0) {
    await interaction.editReply(`ServerPilot cannot use the selected channels. Missing: ${missingChannelPermissions.join('; ')}.`);
    return;
  }

  await ticketConfigurationService.save({
    guildId: guild.id,
    categoryId: category.id,
    supportRoleId: supportRole.id,
    logChannelId: logChannel.id,
    panelChannelId: panelChannel.id,
    enabled: true,
  });
  await interaction.editReply(`Tickets configured. Category: ${category.name}, support role: ${supportRole.name}, logs: <#${logChannel.id}>, panel: <#${panelChannel.id}>.`);
}

async function postTicketPanel(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });
  const configuration = interaction.guild
    ? await ticketConfigurationService.get(interaction.guild.id)
    : undefined;
  if (!configuration?.enabled) {
    await interaction.editReply('Tickets are not configured or are disabled. Use `/tickets setup` first.');
    return;
  }

  const channel = await interaction.guild?.channels.fetch(configuration.panelChannelId).catch(() => undefined);
  if (!isTextChannel(channel)) {
    await interaction.editReply('The configured ticket panel channel is missing or is not a text channel.');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('ServerPilot Support')
    .setDescription('Need help? Use the button below to open a private support ticket. A member of the support team will assist you.');
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('serverpilot:tickets:open').setLabel('🎫 Open Ticket').setStyle(ButtonStyle.Primary),
  );
  try {
    await channel.send({ embeds: [embed], components: [row] });
    await interaction.editReply(`Ticket panel posted in <#${channel.id}>.`);
  } catch (error) {
    const detail = error instanceof DiscordAPIError ? ` Discord error ${error.code}.` : '';
    await interaction.editReply(`ServerPilot could not post the ticket panel.${detail}`);
  }
}

async function getConfiguredTicketData(guild: Guild) {
  const configuration = await ticketConfigurationService.get(guild.id);
  if (!configuration?.enabled) return undefined;
  const category = await guild.channels.fetch(configuration.categoryId).catch(() => undefined);
  const supportRole = await guild.roles.fetch(configuration.supportRoleId).catch(() => undefined);
  if (!category || category.type !== ChannelType.GuildCategory || !supportRole) return undefined;
  return { configuration, category, supportRole };
}

function ticketKey(guildId: string, userId: string) {
  return `${guildId}:${userId}`;
}

function sanitizeTicketName(username: string) {
  const safeName = username.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 75) || 'member';
  return `ticket-${safeName}`;
}

function ticketWelcome(member: GuildMember) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎫 Support Ticket')
    .setDescription(`Welcome <@${member.id}>.\n\nPlease explain your issue and a member of the support team will help you.`);
}

function closeButton() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('serverpilot:tickets:close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Secondary),
  );
}

async function openTicket(interaction: ButtonInteraction) {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.guild) {
    await interaction.editReply('Tickets can only be opened inside a Discord server.');
    return;
  }
  const key = ticketKey(interaction.guild.id, interaction.user.id);
  if (openingTickets.has(key)) {
    await interaction.editReply('Your ticket is already being created. Please wait a moment.');
    return;
  }
  openingTickets.add(key);

  try {
    const data = await getConfiguredTicketData(interaction.guild);
    if (!data) {
      await interaction.editReply('Tickets are not configured or the configuration is no longer valid.');
      return;
    }

    const existing = await ticketService.findOpenByCreator(interaction.guild.id, interaction.user.id);
    if (existing) {
      const existingChannel = await interaction.guild.channels.fetch(existing.channelId).catch(() => undefined);
      if (existingChannel) {
        await interaction.editReply(`You already have an active ticket: <#${existing.channelId}>.`);
        return;
      }
      await ticketService.markDeleted(interaction.guild.id, existing.channelId);
    }

    const botMember = await interaction.guild.members.fetchMe();
    if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.editReply('ServerPilot needs Manage Channels permission to create tickets.');
      return;
    }

    const baseName = sanitizeTicketName(interaction.user.username);
    const existingNames = interaction.guild.channels.cache.map((channel) => channel.name);
    let channelName = baseName;
    let suffix = 2;
    while (existingNames.includes(channelName)) {
      channelName = `${baseName}-${suffix}`.slice(0, 100);
      suffix += 1;
    }

    const creator = await interaction.guild.members.fetch(interaction.user.id);
    const ticketChannel = await interaction.guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: data.category.id,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
        { id: data.supportRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks] },
        { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels] },
      ],
    });
    try {
      await ticketService.open(interaction.guild.id, ticketChannel.id, interaction.user.id);
    } catch (error) {
      await ticketChannel.delete('ServerPilot could not persist the ticket record').catch((cleanupError: unknown) => {
        console.error('Could not clean up an untracked ticket channel.', cleanupError instanceof Error ? cleanupError.name : 'UnknownError');
      });
      throw error;
    }
    try {
      await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [ticketWelcome(creator)], components: [closeButton()] });
    } catch (error) {
      try {
        await ticketService.markDeleted(interaction.guild.id, ticketChannel.id);
      } catch (recordError) {
        console.error('Could not mark an uninitialized ticket deleted.', recordError instanceof Error ? recordError.name : 'UnknownError');
      }
      await ticketChannel.delete('ServerPilot could not initialize the ticket').catch((cleanupError: unknown) => {
        console.error('Could not clean up an uninitialized ticket channel.', cleanupError instanceof Error ? cleanupError.name : 'UnknownError');
      });
      throw error;
    }
    try {
      await automationEngine.process({ guildId: interaction.guild.id, type: 'TICKET_OPENED', client: interaction.client, userId: interaction.user.id, member: creator, channelId: ticketChannel.id, ticketId: ticketChannel.id });
    } catch (error) {
      console.error('Ticket-open automation processing failed.', error instanceof Error ? error.name : 'UnknownError');
    }
    await interaction.editReply(`Your ticket has been created: <#${ticketChannel.id}>.`);
  } catch (error) {
    const detail = error instanceof DiscordAPIError ? ` Discord error ${error.code}.` : '';
    const persistenceFailure = error instanceof TicketPersistenceError || error instanceof TicketRecordPersistenceError;
    await interaction.editReply(persistenceFailure
      ? 'ServerPilot could not create your ticket because ticket storage is unavailable.'
      : `ServerPilot could not create your ticket.${detail}`);
  } finally {
    openingTickets.delete(key);
  }
}

async function closeTicket(interaction: ChatInputCommandInteraction | ButtonInteraction) {
  if (!interaction.guild || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({ content: 'This can only be used inside an active ticket channel.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const guildId = interaction.guild.id;
  try {
    const record = await ticketService.findOpenByChannel(guildId, interaction.channel.id);
    if (!record) {
      await interaction.editReply('This channel is not tracked as an active ticket.');
      return;
    }
    const configuration = await ticketConfigurationService.get(guildId);
    const isCreator = interaction.user.id === record.creatorId;
    const isManager = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    const supportRole = configuration ? await interaction.guild.roles.fetch(configuration.supportRoleId).catch(() => undefined) : undefined;
    const isSupport = supportRole ? interaction.member && 'roles' in interaction.member && (interaction.member as GuildMember).roles.cache.has(supportRole.id) : false;
    if (!isCreator && !isManager && !isSupport) {
      await interaction.editReply('Only the ticket creator, support staff, or server managers can close this ticket.');
      return;
    }

    const channel = interaction.channel as TextChannel;
    const closerTag = interaction.user.tag;
    await channel.permissionOverwrites.edit(record.creatorId, { SendMessages: false });
    await writeTicketLog(interaction.guild, configuration?.logChannelId, record, closerTag, channel.name);
    const closed = await ticketService.close(guildId, channel.id, interaction.user.id);
    if (!closed) {
      await interaction.editReply('This ticket was already closed or removed.');
      return;
    }
    try {
      await automationEngine.process({ guildId: interaction.guild.id, type: 'TICKET_CLOSED', client: interaction.client, userId: record.creatorId, channelId: channel.id, ticketId: channel.id, metadata: { closer: interaction.user.id } });
    } catch (error) {
      console.error('Ticket-close automation processing failed.', error instanceof Error ? error.name : 'UnknownError');
    }
    await interaction.editReply('Ticket closed. This channel will be deleted shortly.');
    setTimeout(() => {
      void channel.delete('ServerPilot ticket closed')
        .then(() => ticketService.markDeleted(guildId, channel.id))
        .catch((error: unknown) => {
          console.error('Ticket channel deletion or record update failed.', error instanceof Error ? error.name : 'UnknownError');
        });
    }, 3000).unref();
  } catch (error) {
    const detail = error instanceof DiscordAPIError ? ` Discord error ${error.code}.` : '';
    const persistenceFailure = error instanceof TicketPersistenceError || error instanceof TicketRecordPersistenceError;
    await interaction.editReply(persistenceFailure
      ? 'ServerPilot could not complete ticket storage operations. The channel will not be deleted.'
      : `ServerPilot could not close this ticket.${detail}`);
  }
}

async function writeTicketLog(guild: Guild, logChannelId: string | undefined, record: TicketRecord, closerTag: string, channelName: string) {
  if (!logChannelId) return;
  const channel = await guild.channels.fetch(logChannelId).catch(() => undefined);
  if (!isTextChannel(channel)) return;
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Ticket Closed')
    .addFields(
      { name: 'Ticket creator', value: `<@${record.creatorId}>`, inline: true },
      { name: 'Closed by', value: closerTag, inline: true },
      { name: 'Channel', value: `#${channelName}`, inline: true },
    )
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => undefined);
}

export async function handleTicketInteraction(interaction: ButtonInteraction) {
  if (!interaction.customId.startsWith('serverpilot:tickets:')) return false;
  const action = interaction.customId.split(':')[2];
  if (action === 'open') await openTicket(interaction);
  else if (action === 'close') await closeTicket(interaction);
  return true;
}
