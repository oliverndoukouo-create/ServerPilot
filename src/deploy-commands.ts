import 'dotenv/config';
import { Client, DiscordAPIError, GatewayIntentBits, REST, Routes } from 'discord.js';
import { pingCommand } from './commands/ping.js';
import { serverCommand } from './commands/server.js';
import { setupCommand } from './commands/setup.js';
import { banCommand, kickCommand, moderationCommand, timeoutCommand, warnCommand } from './commands/moderation.js';
import { welcomeCommand } from './commands/welcome.js';
import { ticketsCommand } from './commands/tickets.js';
import { automationCommand } from './commands/automation.js';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  throw new Error('DISCORD_TOKEN is missing from .env');
}

if (!guildId) {
  throw new Error('DISCORD_GUILD_ID is missing from .env');
}

if (!/^\d{17,20}$/.test(guildId)) {
  throw new Error('DISCORD_GUILD_ID must be a Discord server ID copied with Developer Mode enabled.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

try {
  await new Promise<void>((resolve, reject) => {
    client.once('clientReady', () => resolve());
    client.login(token).catch(reject);
  });

  const guild = await client.guilds.fetch(guildId);
  const applicationId = client.application?.id;

  if (!applicationId) {
    throw new Error('Discord did not provide the application ID after login.');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), {
    body: [
      pingCommand.data.toJSON(),
      serverCommand.data.toJSON(),
      setupCommand.data.toJSON(),
      warnCommand.data.toJSON(),
      timeoutCommand.data.toJSON(),
      kickCommand.data.toJSON(),
      banCommand.data.toJSON(),
      moderationCommand.data.toJSON(),
      welcomeCommand.data.toJSON(),
      ticketsCommand.data.toJSON(),
      automationCommand.data.toJSON(),
    ],
  });

  console.log('Registered ServerPilot commands for the configured test server.');
} catch (error) {
  if (error instanceof DiscordAPIError && (error.code === 50001 || error.code === 10004)) {
    console.error(
      'Discord cannot access DISCORD_GUILD_ID. Confirm it is the test server ID and that the bot is installed in that server.',
    );
  } else {
    console.error('Failed to register /ping:', error);
  }
  process.exitCode = 1;
} finally {
  client.destroy();
}