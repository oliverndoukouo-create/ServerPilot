import { PermissionFlagsBits, type Guild } from 'discord.js';

const requiredPermissions = [
  [PermissionFlagsBits.ViewChannel, 'View Channels'],
  [PermissionFlagsBits.SendMessages, 'Send Messages'],
  [PermissionFlagsBits.EmbedLinks, 'Embed Links'],
  [PermissionFlagsBits.ReadMessageHistory, 'Read Message History'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
] as const;

export async function getMissingBotPermissions(guild: Guild): Promise<string[]> {
  const botMember = await guild.members.fetchMe();
  return requiredPermissions
    .filter(([permission]) => !botMember.permissions.has(permission))
    .map(([, name]) => name);
}