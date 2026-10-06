import { ChannelType, type Guild } from 'discord.js';
import type { AutomationAction, AutomationCondition, AutomationProposal, AutomationTriggerType } from '../automation/types.js';
import { createConfiguredProvider, type AutomationAiInput } from './provider.js';

const supportedTriggers: AutomationTriggerType[] = [
  'MEMBER_JOIN',
  'MEMBER_LEAVE',
  'MESSAGE_CREATE',
  'WARNING_ISSUED',
  'TICKET_OPENED',
  'TICKET_CLOSED',
];

const supportedConditions = ['HAS_ROLE', 'DOES_NOT_HAVE_ROLE', 'WARNING_COUNT', 'CHANNEL_IS'] as const;
const supportedActions = ['ADD_ROLE', 'REMOVE_ROLE', 'SEND_MESSAGE', 'SEND_DM', 'ADD_WARNING', 'TIMEOUT_MEMBER', 'NOTIFY_ROLE'] as const;

const maxNameLength = 100;
const maxSummaryLength = 500;
const maxDescriptionLength = 500;
const maxMessageLength = 2000;
const maxReasonLength = 500;

export class AutomationProposalError extends Error {
  constructor(message: string, public readonly code: 'UNAVAILABLE' | 'CLARIFICATION' | 'INVALID' = 'INVALID') {
    super(message);
    this.name = 'AutomationProposalError';
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeAutomationProposal(value: unknown): unknown {
  if (!isObject(value) || !Array.isArray(value.actions)) {
    return value;
  }

  let changed = false;
  const actions = value.actions.map((action) => {
    if (!isObject(action)
      || action.type !== 'SEND_MESSAGE'
      || typeof action.content !== 'string'
      || Object.hasOwn(action, 'message')) {
      return action;
    }

    // Accept only the known SEND_MESSAGE synonym; all other unknown fields remain for strict validation.
    const { content, ...fields } = action;
    changed = true;
    return { ...fields, message: content };
  });

  return changed ? { ...value, actions } : value;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new AutomationProposalError(`Field ${field} must be a string.`, 'INVALID');
  }
  return value;
}

function matchObjectKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>) {
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new AutomationProposalError('AI response contained unsupported fields.', 'INVALID');
  }
}

export function buildAutomationGuildContext(guild: Guild): AutomationAiInput['context'] {
  const roles = guild.roles.cache
    .filter((role) => role.id !== guild.roles.everyone.id)
    .sort((left, right) => right.position - left.position)
    .map((role) => ({ id: role.id, name: role.name, mentionable: role.mentionable }))
    .slice(0, 80);

  const channels = guild.channels.cache
    .filter((channel) => (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) && channel.isTextBased())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((channel) => {
      const type: 'text' | 'announcement' = channel.type === ChannelType.GuildAnnouncement ? 'announcement' : 'text';
      return { id: channel.id, name: channel.name, type };
    })
    .slice(0, 80);

  return {
    roles,
    channels,
    supportedTriggers: supportedTriggers.map((trigger) => trigger),
    supportedConditions: [...supportedConditions],
    supportedActions: [...supportedActions],
  };
}

function validateTrigger(value: unknown): { type: AutomationTriggerType } {
  if (!isObject(value)) {
    throw new AutomationProposalError('AI trigger is missing or invalid.', 'INVALID');
  }

  matchObjectKeys(value, new Set(['type']));
  const triggerType = asString(value.type, 'trigger.type');
  if (!supportedTriggers.includes(triggerType as AutomationTriggerType)) {
    throw new AutomationProposalError(`Unsupported trigger type: ${triggerType}.`, 'INVALID');
  }

  return { type: triggerType as AutomationTriggerType };
}

function validateCondition(value: unknown, guild: Guild): AutomationCondition {
  if (!isObject(value)) {
    throw new AutomationProposalError('A condition is not an object.', 'INVALID');
  }

  const type = asString(value.type, 'condition.type');
  if (!supportedConditions.includes(type as typeof supportedConditions[number])) {
    throw new AutomationProposalError(`Unsupported condition type: ${type}.`, 'INVALID');
  }

  if (type === 'HAS_ROLE' || type === 'DOES_NOT_HAVE_ROLE') {
    matchObjectKeys(value, new Set(['type', 'roleId']));
    const roleId = asString(value.roleId, 'condition.roleId');
    if (!guild.roles.cache.has(roleId)) {
      throw new AutomationProposalError(`Role not found in this guild: ${roleId}.`, 'INVALID');
    }
    return { type, roleId };
  }

  if (type === 'CHANNEL_IS') {
    matchObjectKeys(value, new Set(['type', 'channelId']));
    const channelId = asString(value.channelId, 'condition.channelId');
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new AutomationProposalError(`Channel not found in this guild: ${channelId}.`, 'INVALID');
    }
    return { type, channelId };
  }

  matchObjectKeys(value, new Set(['type', 'operator', 'value']));
  const operator = asString(value.operator, 'condition.operator');
  const allowedOperators = ['GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL'];
  if (!allowedOperators.includes(operator)) {
    throw new AutomationProposalError(`Unsupported warning count operator: ${operator}.`, 'INVALID');
  }
  const numericValue = Number(value.value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new AutomationProposalError('WARNING_COUNT value must be a non-negative integer.', 'INVALID');
  }
  const warningOperator = operator as 'GREATER_THAN' | 'GREATER_THAN_OR_EQUAL' | 'EQUAL' | 'LESS_THAN' | 'LESS_THAN_OR_EQUAL';
  return { type: 'WARNING_COUNT', operator: warningOperator, value: numericValue };
}

function validateAction(value: unknown, guild: Guild): AutomationAction {
  if (!isObject(value)) {
    throw new AutomationProposalError('An action is not an object.', 'INVALID');
  }

  const type = asString(value.type, 'action.type');
  if (!supportedActions.includes(type as typeof supportedActions[number])) {
    throw new AutomationProposalError(`Unsupported action type: ${type}.`, 'INVALID');
  }

  if (type === 'ADD_ROLE' || type === 'REMOVE_ROLE') {
    matchObjectKeys(value, new Set(['type', 'roleId']));
    const roleId = asString(value.roleId, 'action.roleId');
    if (!guild.roles.cache.has(roleId)) {
      throw new AutomationProposalError(`Role not found in this guild: ${roleId}.`, 'INVALID');
    }
    return { type, roleId };
  }

  if (type === 'SEND_MESSAGE') {
    matchObjectKeys(value, new Set(['type', 'channelId', 'message']));
    const channelId = asString(value.channelId, 'action.channelId');
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new AutomationProposalError(`Channel not found in this guild: ${channelId}.`, 'INVALID');
    }
    const message = asString(value.message, 'action.message');
    if (message.length > maxMessageLength) {
      throw new AutomationProposalError('SEND_MESSAGE message exceeds the supported length.', 'INVALID');
    }
    return { type, channelId, message };
  }

  if (type === 'SEND_DM') {
    matchObjectKeys(value, new Set(['type', 'message']));
    const message = asString(value.message, 'action.message');
    if (message.length > maxMessageLength) {
      throw new AutomationProposalError('SEND_DM message exceeds the supported length.', 'INVALID');
    }
    return { type, message };
  }

  if (type === 'ADD_WARNING') {
    matchObjectKeys(value, new Set(['type', 'reason']));
    const reason = asString(value.reason, 'action.reason');
    if (reason.length > maxReasonLength) {
      throw new AutomationProposalError('ADD_WARNING reason exceeds the supported length.', 'INVALID');
    }
    return { type, reason };
  }

  if (type === 'TIMEOUT_MEMBER') {
    matchObjectKeys(value, new Set(['type', 'durationMinutes', 'reason']));
    const durationMinutes = Number(value.durationMinutes);
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 28 * 24 * 60) {
      throw new AutomationProposalError('TIMEOUT_MEMBER duration must be between 1 minute and 28 days.', 'INVALID');
    }
    const reason = asString(value.reason, 'action.reason');
    if (reason.length > maxReasonLength) {
      throw new AutomationProposalError('TIMEOUT_MEMBER reason exceeds the supported length.', 'INVALID');
    }
    return { type, durationMinutes, reason };
  }

  matchObjectKeys(value, new Set(['type', 'roleId', 'channelId', 'message']));
  const roleId = asString(value.roleId, 'action.roleId');
  const channelId = asString(value.channelId, 'action.channelId');
  if (roleId === guild.id) {
    throw new AutomationProposalError('NOTIFY_ROLE cannot target @everyone.', 'INVALID');
  }
  if (!guild.roles.cache.has(roleId)) {
    throw new AutomationProposalError(`Role not found in this guild: ${roleId}.`, 'INVALID');
  }
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new AutomationProposalError(`Channel not found in this guild: ${channelId}.`, 'INVALID');
  }
  const message = asString(value.message, 'action.message');
  if (message.length > maxMessageLength) {
    throw new AutomationProposalError('NOTIFY_ROLE message exceeds the supported length.', 'INVALID');
  }
  return { type: 'NOTIFY_ROLE', roleId, channelId, message };
}

export function validateAutomationProposal(value: unknown, guild: Guild, description: string): AutomationProposal {
  if (!isObject(value)) {
    throw new AutomationProposalError('AI returned invalid JSON for the automation proposal.', 'INVALID');
  }

  const allowedKeys = new Set([
    'proposalId',
    'guildId',
    'name',
    'description',
    'trigger',
    'conditions',
    'actions',
    'summary',
    'riskWarnings',
    'requiresConfirmation',
  ]);
  matchObjectKeys(value, allowedKeys);

  const proposalId = asString(value.proposalId, 'proposalId');
  const guildId = asString(value.guildId, 'guildId');
  if (guildId !== guild.id) {
    throw new AutomationProposalError('The proposal is for a different guild than the current server.', 'INVALID');
  }

  const name = asString(value.name, 'name');
  if (name.trim().length === 0 || name.length > maxNameLength) {
    throw new AutomationProposalError('Automation name is missing or too long.', 'INVALID');
  }

  const descriptionValue = value.description === undefined ? undefined : asString(value.description, 'description');
  if (descriptionValue !== undefined && (descriptionValue.length > maxDescriptionLength || descriptionValue.trim().length === 0)) {
    throw new AutomationProposalError('The automation description is invalid.', 'INVALID');
  }

  if (value.requiresConfirmation !== true) {
    throw new AutomationProposalError('AI proposal must require explicit confirmation.', 'INVALID');
  }

  const summary = asString(value.summary, 'summary');
  if (summary.trim().length === 0 || summary.length > maxSummaryLength) {
    throw new AutomationProposalError('Proposal summary is missing or too long.', 'INVALID');
  }

  const riskWarnings = Array.isArray(value.riskWarnings) ? value.riskWarnings.map((warning) => asString(warning, 'riskWarnings[]')).filter((warning) => warning.trim().length > 0).slice(0, 10) : [];
  if (value.riskWarnings !== undefined && !Array.isArray(value.riskWarnings)) {
    throw new AutomationProposalError('riskWarnings must be an array of strings.', 'INVALID');
  }

  const trigger = validateTrigger(value.trigger);
  const conditions = Array.isArray(value.conditions) ? value.conditions.map((condition) => validateCondition(condition, guild)) : [];
  const actions = Array.isArray(value.actions) ? value.actions.map((action) => validateAction(action, guild)) : [];
  if (actions.length === 0) {
    throw new AutomationProposalError('Automation proposals must include at least one action.', 'INVALID');
  }

  if (description.trim().length < 8) {
    throw new AutomationProposalError('Please describe the automation in more detail.', 'INVALID');
  }

  return {
    proposalId,
    guildId,
    name: name.trim(),
    ...(descriptionValue !== undefined ? { description: descriptionValue.trim() } : {}),
    trigger,
    conditions,
    actions,
    summary: summary.trim(),
    riskWarnings,
    requiresConfirmation: true,
  };
}

export async function generateAiAutomationProposal(guild: Guild, description: string): Promise<AutomationProposal> {
  if (!description.trim()) {
    throw new AutomationProposalError('Describe the automation you want to create.', 'INVALID');
  }

  const provider = createConfiguredProvider();
  if (!provider) {
    throw new AutomationProposalError('AI automation is not configured in this environment. Please try again later.', 'UNAVAILABLE');
  }

  let candidate: unknown;
  try {
    candidate = await provider.generateAutomationProposal({
      guildId: guild.id,
      description: description.trim(),
      context: buildAutomationGuildContext(guild),
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new AutomationProposalError('The AI returned invalid JSON. Please try again with a simpler request.', 'INVALID');
    }
    throw new AutomationProposalError('The AI provider could not complete the request. Please try again later.', 'UNAVAILABLE');
  }

  if (candidate && isObject(candidate) && 'clarification' in candidate && typeof candidate.clarification === 'string' && candidate.clarification.trim().length > 0) {
    throw new AutomationProposalError('The AI could not resolve a role or channel unambiguously. Please name the exact role or channel and try again.', 'CLARIFICATION');
  }

  return validateAutomationProposal(normalizeAutomationProposal(candidate), guild, description);
}
