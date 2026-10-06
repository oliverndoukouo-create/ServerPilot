import { PermissionFlagsBits, type GuildMember, type TextChannel } from 'discord.js';
import { getWarningCount, recordWarning } from './warnings.js';
import { automationService } from './service.js';
import { moderationService } from '../moderation/store.js';
import type { Automation, AutomationAction, AutomationCondition, AutomationEvent } from './types.js';

const processingEvents = new Set<string>();
const maxAutomationDepth = 5;

function eventKey(event: AutomationEvent) {
  return `${event.guildId}:${event.type}:${event.userId ?? ''}:${event.channelId ?? ''}`;
}

function getMember(event: AutomationEvent) {
  return event.member ?? (event.userId ? event.client.guilds.cache.get(event.guildId)?.members.cache.get(event.userId) : undefined);
}

function conditionMatches(condition: AutomationCondition, event: AutomationEvent) {
  const member = getMember(event);
  if (condition.type === 'HAS_ROLE') return Boolean(member?.roles.cache.has(condition.roleId));
  if (condition.type === 'DOES_NOT_HAVE_ROLE') return !member?.roles.cache.has(condition.roleId);
  if (condition.type === 'CHANNEL_IS') return event.channelId === condition.channelId;
  if (condition.type !== 'WARNING_COUNT') return false;
  const count = event.warningCount ?? (event.userId ? getWarningCount(event.guildId, event.userId) : 0);
  if (condition.operator === 'GREATER_THAN') return count > condition.value;
  if (condition.operator === 'GREATER_THAN_OR_EQUAL') return count >= condition.value;
  if (condition.operator === 'EQUAL') return count === condition.value;
  if (condition.operator === 'LESS_THAN') return count < condition.value;
  return count <= condition.value;
}

function render(message: string, event: AutomationEvent) {
  const member = getMember(event);
  return message
    .replaceAll('{user}', member ? `<@${member.id}>` : event.userId ? `<@${event.userId}>` : '')
    .replaceAll('{username}', member?.user.username ?? '')
    .replaceAll('{server}', event.client.guilds.cache.get(event.guildId)?.name ?? '')
    .replaceAll('{membercount}', event.client.guilds.cache.get(event.guildId)?.memberCount.toLocaleString() ?? '');
}

async function executeAction(action: AutomationAction, event: AutomationEvent) {
  const guild = event.client.guilds.cache.get(event.guildId);
  const member = getMember(event);
  if (!guild) return;
  const botMember = await guild.members.fetchMe();

  if (action.type === 'SEND_MESSAGE' || action.type === 'NOTIFY_ROLE') {
    const channelId = action.channelId;
    const channel = await guild.channels.fetch(channelId ?? '').catch(() => undefined) as TextChannel | undefined;
    if (!channel?.isTextBased()) return;
    const channelPermissions = channel.permissionsFor(botMember);
    if (!channelPermissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) return;
    if (action.type === 'NOTIFY_ROLE' && (action.roleId === guild.id || !(await guild.roles.fetch(action.roleId).catch(() => undefined)))) return;
    const content = action.type === 'NOTIFY_ROLE' ? `<@&${action.roleId}> ${render(action.message, event)}` : render(action.message, event);
    await channel.send({
      content,
      allowedMentions: {
        parse: [],
        users: event.userId ? [event.userId] : [],
        roles: action.type === 'NOTIFY_ROLE' ? [action.roleId] : [],
        repliedUser: false,
      },
    });
    return;
  }
  if (action.type === 'SEND_DM') {
    if (member) {
      await member.send({
        content: render(action.message, event),
        allowedMentions: { parse: [], users: [member.id], repliedUser: false },
      });
    }
    return;
  }
  if (!member) return;
  if (action.type === 'ADD_WARNING') {
    const reason = render(action.reason, event);
    const count = recordWarning(event.guildId, member.id, 'automation', reason);
    await moderationService.record({
      guildId: event.guildId,
      targetUserId: member.id,
      moderatorUserId: 'automation',
      action: 'warn',
      reason,
    });
    await process({ ...event, type: 'WARNING_ISSUED', userId: member.id, member, warningCount: count, automationDepth: (event.automationDepth ?? 0) + 1 });
    return;
  }
  if (action.type === 'ADD_ROLE' || action.type === 'REMOVE_ROLE') {
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    const role = await guild.roles.fetch(action.roleId).catch(() => undefined);
    if (!role || role.position >= botMember.roles.highest.position || role.managed) return;
    if (action.type === 'ADD_ROLE') await member.roles.add(role);
    else await member.roles.remove(role);
    return;
  }
  if (action.type === 'TIMEOUT_MEMBER' && member.id !== guild.ownerId && member.roles.highest.position < botMember.roles.highest.position && botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    if (!member.communicationDisabledUntilTimestamp || member.communicationDisabledUntilTimestamp <= Date.now()) {
      await member.timeout(Math.min(Math.max(action.durationMinutes, 1), 28 * 24 * 60) * 60 * 1000, render(action.reason, event));
    }
  }
}

async function process(event: AutomationEvent) {
  if ((event.automationDepth ?? 0) >= maxAutomationDepth) {
    console.warn(`Automation chain stopped at depth ${maxAutomationDepth} for ${event.guildId}.`);
    return;
  }
  const key = eventKey(event);
  if (processingEvents.has(key)) return;
  processingEvents.add(key);
  try {
    for (const automation of await automationService.listForGuild(event.guildId)) {
      if (!automation.enabled || automation.trigger.type !== event.type) continue;
      if (!automation.conditions.every((condition) => conditionMatches(condition, event))) continue;
      for (const action of automation.actions) {
        try { await executeAction(action, event); } catch (error) { console.error(`Automation action failed (${automation.id}).`, error); }
      }
    }
  } finally {
    processingEvents.delete(key);
  }
}

export const automationEngine = { process };
