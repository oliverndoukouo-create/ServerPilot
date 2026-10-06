import { PermissionFlagsBits } from 'discord.js';
import { applyExplicitSetupIntent, createSetupPlan, extractSetupIntent } from '../setup/planner.js';
import type { SetupAnswers, SetupCategory, SetupPlan, SetupRole, SetupType } from '../setup/types.js';
import { createConfiguredProvider } from './provider.js';

const maxCategories = 20;
const maxChannelsPerCategory = 25;
const maxVoiceChannelsPerCategory = 10;
const maxRoles = 20;
const maxNameLength = 100;
const allowedRolePermissions = new Set([
  'KickMembers',
  'BanMembers',
  'ManageMessages',
  'ModerateMembers',
  'ViewChannel',
  'SendMessages',
  'EmbedLinks',
  'ReadMessageHistory',
]);
const allowedPermissionBits: Record<string, bigint> = {
  KickMembers: PermissionFlagsBits.KickMembers,
  BanMembers: PermissionFlagsBits.BanMembers,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  EmbedLinks: PermissionFlagsBits.EmbedLinks,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
};

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateCategory(value: unknown, voice: boolean): value is SetupCategory {
  if (!value || typeof value !== 'object') return false;
  const category = value as Partial<SetupCategory>;
  const maxChannels = voice ? maxVoiceChannelsPerCategory : maxChannelsPerCategory;
  return isString(category.name)
    && category.name.length <= maxNameLength
    && Array.isArray(category.channels)
    && category.channels.length <= maxChannels
    && category.channels.every((channel) => isString(channel) && channel.length <= maxNameLength);
}

function validateRole(value: unknown): value is SetupRole {
  if (!value || typeof value !== 'object') return false;
  const role = value as Partial<SetupRole>;
  const permissions = Array.isArray(role.permissions) ? role.permissions : undefined;
  let permissionValueIsSafe = false;
  try {
    const permissionValue = BigInt(role.permissionsValue ?? 'invalid');
    const expectedValue = permissions?.reduce((total, permission) => total | (allowedPermissionBits[permission] ?? 0n), 0n) ?? -1n;
    permissionValueIsSafe = permissionValue >= 0n
      && permissionValue === expectedValue
      && permissions?.every((permission) => allowedRolePermissions.has(permission)) === true;
  } catch {
    permissionValueIsSafe = false;
  }

  return isString(role.name)
    && role.name.length <= maxNameLength
    && isString(role.purpose)
    && role.purpose.length <= 500
    && Array.isArray(permissions)
    && permissions.every((permission) => typeof permission === 'string' && allowedRolePermissions.has(permission))
    && typeof role.permissionsValue === 'string'
    && permissionValueIsSafe
    && typeof role.color === 'number'
    && Number.isInteger(role.color)
    && role.color >= 0
    && role.color <= 0xffffff
    && (role.kind === 'owner' || role.kind === 'staff' || role.kind === 'member' || role.kind === 'vip' || role.kind === 'bot')
    && (role.recommended === true || role.recommended === false)
    && (role.explicitlyRequested === true || role.explicitlyRequested === false);
}

function validatePlan(value: unknown, type: SetupType, description: string): value is SetupPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as Partial<SetupPlan>;
  if (!Array.isArray(plan.categories) || !Array.isArray(plan.voiceCategories) || !Array.isArray(plan.roles)) return false;
  const categoryNames = plan.categories.map((category) => isString(category?.name) ? category.name.toLowerCase() : '');
  const voiceCategoryNames = plan.voiceCategories.map((category) => isString(category?.name) ? category.name.toLowerCase() : '');
  const textChannelNames = plan.categories.flatMap((category) => Array.isArray(category?.channels) ? category.channels : []);
  const voiceChannelNames = plan.voiceCategories.flatMap((category) => Array.isArray(category?.channels) ? category.channels : []);
  const roleNames = plan.roles.map((role) => isString(role?.name) ? role.name.toLowerCase() : '');
  const hasUniqueNames = (names: string[]) => new Set(names).size === names.length;
  return plan.type === type
    && plan.description === description
    && Array.isArray(plan.categories)
    && plan.categories.length <= maxCategories
    && plan.categories.every((category) => validateCategory(category, false))
    && hasUniqueNames(categoryNames)
    && hasUniqueNames(textChannelNames)
    && textChannelNames.length <= 100
    && Array.isArray(plan.voiceCategories)
    && plan.voiceCategories.length <= maxCategories
    && plan.voiceCategories.every((category) => validateCategory(category, true))
    && hasUniqueNames(voiceCategoryNames)
    && hasUniqueNames(voiceChannelNames)
    && voiceChannelNames.length <= 30
    && Array.isArray(plan.roles)
    && plan.roles.length <= maxRoles
    && plan.roles.every(validateRole)
    && hasUniqueNames(roleNames)
    && Array.isArray(plan.recommendedFeatures)
    && Array.isArray(plan.requestedFeatures)
    && Array.isArray(plan.skippedFeatures)
    && Array.isArray(plan.rules)
    && plan.rules.length <= 5
    && plan.rules.every((rule) => typeof rule === 'string' && rule.trim().length >= 6 && rule.trim().length <= 160)
    && hasUniqueNames(plan.rules.map((rule) => rule.trim().toLowerCase()))
    && (plan.categories.some((category) => category.channels.includes('rules')) || plan.rules.length === 0);
}

export async function generateSetupPlan(type: SetupType, description: string, answers: SetupAnswers = {}): Promise<SetupPlan> {
  const fallbackPlan = createSetupPlan(type, description, answers);
  const provider = createConfiguredProvider();
  if (!provider) {
    return fallbackPlan;
  }

  try {
    const intent = extractSetupIntent(type, description);
    const candidate = await provider.generatePlan({ type, description, intent, fallbackPlan });
    if (validatePlan(candidate, type, description)) {
      const reconciled = applyExplicitSetupIntent(candidate, intent, fallbackPlan);
      if (validatePlan(reconciled, type, description)) return reconciled;
      console.warn('AI setup plan exceeded safety limits after applying explicit user intent; using deterministic fallback.');
    } else {
      console.warn('AI provider returned an invalid setup plan; using deterministic fallback.');
    }
  } catch {
    console.warn('AI provider was unavailable; using deterministic setup planning.');
  }

  return fallbackPlan;
}