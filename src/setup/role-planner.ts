import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import type { SetupAnswers, SetupQuestion, SetupRole, SetupType } from './types.js';

const roleQuestions: Record<SetupType, SetupQuestion[]> = {
  Gaming: [
    { id: 'roles-moderators', label: 'Would you like dedicated moderator roles?', feature: 'roles-moderators' },
    { id: 'roles-vip', label: 'Would you like a VIP or supporter role?', feature: 'roles-vip' },
  ],
  Esports: [
    { id: 'roles-moderators', label: 'Would you like dedicated moderator roles?', feature: 'roles-moderators' },
    { id: 'roles-tournament-staff', label: 'Will your server have tournament or event staff?', feature: 'roles-tournament-staff' },
    { id: 'roles-team-captains', label: 'Would you like team captain roles?', feature: 'roles-team-captains' },
  ],
  Creator: [
    { id: 'roles-moderators', label: 'Would you like dedicated moderator roles?', feature: 'roles-moderators' },
    { id: 'roles-vip', label: 'Would you like a VIP or supporter role?', feature: 'roles-vip' },
  ],
  Community: [
    { id: 'roles-moderators', label: 'Would you like dedicated moderator roles?', feature: 'roles-moderators' },
    { id: 'roles-vip', label: 'Would you like a VIP role?', feature: 'roles-vip' },
  ],
  Business: [
    { id: 'roles-moderators', label: 'Would you like dedicated moderator roles?', feature: 'roles-moderators' },
    { id: 'roles-support', label: 'Would you like a support staff role?', feature: 'roles-support' },
  ],
  Custom: [
    { id: 'roles-moderators', label: 'Would you like dedicated moderator roles?', feature: 'roles-moderators' },
    { id: 'roles-vip', label: 'Would you like a VIP or supporter role?', feature: 'roles-vip' },
  ],
};

const roleKeywords: Record<string, string[]> = {
  'roles-moderators': ['moderator', 'moderators', 'mod team'],
  'roles-vip': ['vip', 'supporter', 'supporters', 'premium', 'patron', 'donor', 'donors', 'booster', 'boosters', 'paid member', 'paid members', 'paid tier', 'paid tiers', 'premium membership', 'premium memberships', 'supporter role', 'supporter roles', 'special access tier', 'special access tiers'],
  'roles-tournament-staff': ['tournament staff', 'event staff', 'tournament organizer', 'event organizer'],
  'roles-team-captains': ['team captain', 'team captains', 'captain'],
  'roles-support': ['support staff', 'customer support', 'support team'],
};

function contains(text: string, terms: string[]) {
  return terms.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '\\s+');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
  });
}

function explicitlyExcluded(text: string, terms: string[]) {
  const normalized = text.toLowerCase().replace(/[’]/g, "'");
  return normalized.split(/[.!?;,\n]|\bbut\b|\bhowever\b/).some((clause) => terms.some((term) => {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll(' ', '\\s+');
    return new RegExp(String.raw`(?:\bno\s+|\bwithout\s+|\bskip\s+|\bexclude\s+|\bleave\s+out\s+|\bnot\s+(?:\w+\s+){0,2}|\bno\s+need\s+(?:for\s+)?|\bdon't\s+(?:want|need|add|include|create|use)\s+(?:any\s+)?|\bdo\s+not\s+(?:want|need|add|include|create|use)\s+(?:any\s+)?|\bwe\s+don't\s+(?:use|need|want)\s+(?:any\s+)?|\bi\s+don't\s+(?:use|need|want)\s+(?:any\s+)?)[^.!?;,:]{0,35}\b${escapedTerm}\b`, 'i').test(clause);
  }));
}

export function getRoleQuestions(type: SetupType, description: string) {
  const normalized = description.toLowerCase();
  if (/\b(?:simple|basic|minimal|tiny|private|keep it simple|keep it minimal|nothing over the top|not over the top|don't make it massive|don't overdo it|nothing fancy|nothing too complicated|not too complicated|no complicated roles)\b/i.test(normalized)
    || /\b(?:just|only)\s+(?:for\s+)?(?:me|us)\s+and\s+\d+\s+friends\b/i.test(normalized)) return [];
  return roleQuestions[type].filter((question) => {
    const terms = roleKeywords[question.id] ?? [];
    if (question.id === 'roles-moderators' && (/\b(?:light|lightweight|relaxed)\s+moderation\b|\bkeep moderation light\b/i.test(normalized)
      || explicitlyExcluded(normalized, ['moderator', 'moderators', 'staff team', 'staff roles']))) return false;
    return !contains(normalized, terms) && !explicitlyExcluded(normalized, terms);
  });
}

function role(
  name: string,
  purpose: string,
  color: number,
  kind: SetupRole['kind'],
  permissions: bigint[],
  recommended: boolean,
  explicitlyRequested: boolean,
): SetupRole {
  const permissionNames = permissions.map((permission) => Object.entries(PermissionFlagsBits).find(([, value]) => value === permission)?.[0] ?? 'Unknown');
  return {
    name,
    purpose,
    color,
    permissions: permissionNames,
    permissionsValue: new PermissionsBitField(permissions).bitfield.toString(),
    kind,
    recommended,
    explicitlyRequested,
  };
}

export function createRolePlan(type: SetupType, description: string, answers: SetupAnswers = {}): SetupRole[] {
  const normalized = description.toLowerCase();
  const roles: SetupRole[] = [
    role('👑 Owner', 'Server owner identity; no additional permissions are assigned automatically.', 0xf1c40f, 'owner', [], false, contains(normalized, ['owner'])),
    role('🎮 Member', 'Normal community member access.', 0x95a5a6, 'member', [], true, true),
  ];
  const naturalText = normalized.replace(/[’]/g, "'").replace(/\bdont\b/g, "don't");
  const sizeMatch = naturalText.match(/\b(?:around|about|approximately|roughly|like|for|with)?\s*(\d{1,6})\s*(?:members?|people|mates|friends?|users?)\b/);
  const smallCommunity = Boolean(sizeMatch && Number(sizeMatch[1]) <= 50) || /\b(?:small|tiny|private|friends|mates|a few people)\b/i.test(normalized);
  const strictModeration = /\b(?:strict|tough|strong)\s+moderation\b|\bmoderation (?:is )?strict\b/i.test(naturalText);
  const excludesStaff = explicitlyExcluded(normalized, ['staff', 'staff team', 'staff roles', 'moderators', 'moderator', 'moderation team'])
    || /\bno complicated roles\b|\bno complicated staff\b|\b(?:simple|basic|minimal|tiny|private)\b/i.test(naturalText) && !contains(naturalText, ['staff', 'moderators', 'moderator', 'support staff', 'event staff']);
  const requestsStaff = contains(naturalText, ['staff', 'staff team', 'staff members', 'moderators', 'moderator'])
    && !excludesStaff;
  const includeRole = (questionId: string, answer: SetupAnswers[string] | undefined, recommended = false) => {
    const terms = roleKeywords[questionId] ?? [];
    return answer === 'yes'
      || (answer !== 'no' && !explicitlyExcluded(normalized, terms) && (contains(normalized, terms) || (answer === 'decide' && recommended)));
  };
  const applicationsSignal = contains(naturalText, ['application', 'applications', 'recruitment']);
  const size = sizeMatch ? Number(sizeMatch[1]) : 0;
  const moderators = !excludesStaff && (strictModeration || requestsStaff || size > 250 && applicationsSignal || includeRole('roles-moderators', answers['roles-moderators'], !smallCommunity));
  const vip = !excludesStaff && includeRole('roles-vip', answers['roles-vip']);
  const tournamentStaff = !excludesStaff && includeRole('roles-tournament-staff', answers['roles-tournament-staff'], type === 'Esports');
  const captains = !excludesStaff && includeRole('roles-team-captains', answers['roles-team-captains'], true);
  const support = !excludesStaff && includeRole('roles-support', answers['roles-support'], true);

  if (moderators) {
    roles.push(role('🔨 Moderator', 'Moderation tools without server-wide administration.', 0xe67e22, 'staff', [PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ModerateMembers], answers['roles-moderators'] === 'decide', strictModeration || answers['roles-moderators'] === 'yes' || contains(normalized, roleKeywords['roles-moderators'] ?? [])));
  }
  if (tournamentStaff) {
    roles.push(role('🏆 Tournament Staff', 'Coordinate tournament and event channels.', 0x9b59b6, 'staff', [PermissionFlagsBits.ManageMessages], answers['roles-tournament-staff'] === 'decide', answers['roles-tournament-staff'] === 'yes' || contains(normalized, roleKeywords['roles-tournament-staff'] ?? [])));
  }
  if (captains) {
    roles.push(role('👥 Team Captain', 'Identify team leaders without elevated server permissions.', 0x3498db, 'member', [], answers['roles-team-captains'] === 'decide', answers['roles-team-captains'] === 'yes' || contains(normalized, roleKeywords['roles-team-captains'] ?? [])));
  }
  if (support) {
    roles.push(role('🛠️ Support Staff', 'Handle support conversations without administrative permissions.', 0x1abc9c, 'staff', [PermissionFlagsBits.ManageMessages], answers['roles-support'] === 'decide', answers['roles-support'] === 'yes' || contains(normalized, roleKeywords['roles-support'] ?? [])));
  }
  if (vip) {
    roles.push(role('⭐ VIP', 'Identify VIP or supporter members; no dangerous permissions.', 0xf39c12, 'vip', [], answers['roles-vip'] === 'decide', answers['roles-vip'] === 'yes' || contains(normalized, roleKeywords['roles-vip'] ?? [])));
  }
  return roles;
}