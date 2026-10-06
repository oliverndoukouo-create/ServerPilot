import 'dotenv/config';
import 'dotenv/config';
import { ActivityType, Client, GatewayIntentBits } from 'discord.js';
import { pingCommand } from './commands/ping.js';
import { serverCommand } from './commands/server.js';
import { handleSetupInteraction, setupCommand } from './commands/setup.js';
import { banCommand, kickCommand, moderationCommand, timeoutCommand, warnCommand } from './commands/moderation.js';
import { sendWelcomeMessage, welcomeCommand } from './commands/welcome.js';
import { handleTicketInteraction, ticketsCommand } from './commands/tickets.js';
import { automationCommand, handleAutomationInteraction } from './commands/automation.js';
import { automationEngine } from './automation/engine.js';
import { getSupabaseClient } from './db.js';
import { SupabaseGuildRepository } from './guilds/repository.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('DISCORD_TOKEN is missing from .env');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});

client.once('clientReady', async (readyClient) => {
  readyClient.user.setPresence({
    status: 'online',
    activities: [{ name: 'ServerPilot • /help', type: ActivityType.Playing }],
  });
  console.log(`ServerPilot is online as ${readyClient.user.tag}`);
  const database = getSupabaseClient();
  if (database) {
    try {
      await new SupabaseGuildRepository(database).syncGuilds(readyClient.guilds.cache.map((guild) => ({
        id: guild.id,
        name: guild.name,
        ...(guild.icon ? { iconHash: guild.icon } : {}),
        ownerUserId: guild.ownerId,
      })));
    } catch (error) {
      console.error('Could not synchronize guild metadata to persistence.', error instanceof Error ? error.name : 'UnknownError');
    }
  }
});

client.on('guildCreate', async (guild) => {
  const database = getSupabaseClient();
  if (!database) return;
  try {
    await new SupabaseGuildRepository(database).syncGuilds([{
      id: guild.id,
      name: guild.name,
      ...(guild.icon ? { iconHash: guild.icon } : {}),
      ownerUserId: guild.ownerId,
    }]);
  } catch (error) {
    console.error('Could not synchronize newly joined guild metadata.', error instanceof Error ? error.name : 'UnknownError');
  }
});

client.on('guildUpdate', async (_oldGuild, guild) => {
  const database = getSupabaseClient();
  if (!database) return;
  try {
    await new SupabaseGuildRepository(database).syncGuilds([{
      id: guild.id,
      name: guild.name,
      ...(guild.icon ? { iconHash: guild.icon } : {}),
      ownerUserId: guild.ownerId,
    }]);
  } catch (error) {
    console.error('Could not synchronize updated guild metadata.', error instanceof Error ? error.name : 'UnknownError');
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === pingCommand.data.name) {
        await pingCommand.execute(interaction);
      } else if (interaction.commandName === serverCommand.data.name) {
        await serverCommand.execute(interaction);
      } else if (interaction.commandName === setupCommand.data.name) {
        await setupCommand.execute(interaction);
      } else if (interaction.commandName === warnCommand.data.name) {
        await warnCommand.execute(interaction);
      } else if (interaction.commandName === timeoutCommand.data.name) {
        await timeoutCommand.execute(interaction);
      } else if (interaction.commandName === kickCommand.data.name) {
        await kickCommand.execute(interaction);
      } else if (interaction.commandName === banCommand.data.name) {
        await banCommand.execute(interaction);
      } else if (interaction.commandName === moderationCommand.data.name) {
        await moderationCommand.execute(interaction);
      } else if (interaction.commandName === welcomeCommand.data.name) {
        await welcomeCommand.execute(interaction);
      } else if (interaction.commandName === ticketsCommand.data.name) {
        await ticketsCommand.execute(interaction);
      } else if (interaction.commandName === automationCommand.data.name) {
        await automationCommand.execute(interaction);
      }
    } else if (interaction.isStringSelectMenu() || interaction.isButton() || interaction.isModalSubmit()) {
      if (!((interaction.isButton() && await handleTicketInteraction(interaction))
        || ((interaction.isButton() || interaction.isModalSubmit()) && await handleAutomationInteraction(interaction)))) {
        await handleSetupInteraction(interaction);
      }
    }
  } catch (error) {
    console.error('Failed to handle interaction:', error);
    if (interaction.isRepliable() && !interaction.replied) {
      const response = {
        content: 'ServerPilot could not complete that request. Please try again after checking the bot permissions.',
        ephemeral: true,
      };
      if (interaction.deferred) await interaction.editReply(response);
      else await interaction.reply(response);
    }
  }
});

client.on('guildMemberAdd', async (member) => {
  try {
    await sendWelcomeMessage(member);
  } catch (error) {
    console.error('Welcome event processing failed.', error instanceof Error ? error.name : 'UnknownError');
  }
  try {
    await automationEngine.process({ guildId: member.guild.id, type: 'MEMBER_JOIN', client, member, userId: member.id });
  } catch (error) {
    console.error('Member-join automation processing failed.', error instanceof Error ? error.name : 'UnknownError');
  }
});

client.on('guildMemberRemove', async (member) => {
  try {
    await automationEngine.process({ guildId: member.guild.id, type: 'MEMBER_LEAVE', client, userId: member.id });
  } catch (error) {
    console.error('Member-leave automation processing failed.', error instanceof Error ? error.name : 'UnknownError');
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;
  try {
    await automationEngine.process({ guildId: message.guild.id, type: 'MESSAGE_CREATE', client, userId: message.author.id, ...(message.member ? { member: message.member } : {}), channelId: message.channel.id, message });
  } catch (error) {
    console.error('Message automation processing failed.', error instanceof Error ? error.name : 'UnknownError');
  }
});

client.login(token);