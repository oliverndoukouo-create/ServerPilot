import 'dotenv/config';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { generateSetupPlan } from '../src/ai/planner.js';
import { OpenAiCompatibleProvider } from '../src/ai/provider.js';
import { createSetupPlan, extractSetupIntent } from '../src/setup/planner.js';
import type { SetupPlan, SetupType } from '../src/setup/types.js';

export type Model = { id: string; name: string };
export type Scenario = {
  id: number;
  label: string;
  type: SetupType;
  prompt: string;
  required: string[];
  forbidden: string[];
  minimumVoice?: number;
  exactVoice?: number;
  maxResources?: number;
};
type ProviderCatalog = Array<{ id?: string; name?: string }>;
type RawResponse = {
  bodyText: string;
  rawContent: string | null;
  rawProposal?: unknown;
  httpStatus: number;
  latencyMs: number;
  request: {
    model: string;
    type: SetupType;
    prompt: string;
    temperature: 0.2;
    responseFormat: { type: 'json_object' };
    systemPrompt: string;
    userPayload: string;
  };
};
type FailureKind = 'rate_limit' | 'timeout' | 'provider_error' | 'malformed_json' | 'missing_content';
type Attempt = {
  model: Model;
  promptId: number;
  repeat: number;
  attempted: boolean;
  source: 'AI' | 'FALLBACK';
  providerResponseReceived: boolean;
  httpStatus?: number;
  failureKind?: FailureKind;
  failureMessage?: string;
  skipReason?: string;
  latencyMs?: number;
  rawResponseText?: string;
  request?: RawResponse['request'];
  rawProposal?: unknown;
  jsonValid: boolean;
  schemaValidation: 'pass' | 'fail' | 'not-run';
  schemaDiagnostics: { unsupportedFields: string[]; missingRequiredFields: string[] };
  reconciliation: 'clean' | 'changed' | 'fallback' | 'not-run';
  fallbackReason?: string;
  finalPlan: SetupPlan;
  rawScores?: Record<string, number | string>;
  finalScores: Record<string, number>;
  errors: ErrorFlags;
  severity: 'none' | 'minor' | 'major' | 'critical';
};
type ErrorFlags = {
  inventedChannel: boolean;
  inventedCategory: boolean;
  inventedRole: boolean;
  inventedGame: boolean;
  inventedMonetisation: boolean;
  unsafePermissionEscalation: boolean;
  inventedVip: boolean;
  inventedRecruitment: boolean;
  inventedSupportOrTickets: boolean;
  inventedTournament: boolean;
  ignoredExplicitRequest: boolean;
  violatedExplicitExclusion: boolean;
  excessiveScale: boolean;
  insufficientScale: boolean;
  malformedJson: boolean;
  schemaValidationFailure: boolean;
};
type Hooks = {
  catalog(): Promise<ProviderCatalog>;
  send(model: Model, scenario: Scenario, repeat: number): Promise<RawResponse>;
  reconcile(model: Model, scenario: Scenario, proposal: unknown, rawText: string): Promise<{
    plan: SetupPlan;
    accepted: boolean;
    warning?: string;
  }>;
  sleep(ms: number): Promise<void>;
  onAttempt?(attempt: Attempt): Promise<void> | void;
};

export const models: Model[] = [
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B A4B free' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B free' },
  { id: 'nvidia/nemotron-3-ultra:free', name: 'Nemotron 3 Ultra free' },
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning free' },
  { id: 'dots-studio/dots-3-note-preview:free', name: 'Dots3-Note Preview free' },
];

export const scenarios: Scenario[] = [
  {
    id: 1,
    label: 'Small Minecraft',
    type: 'Gaming',
    prompt: 'I need a Minecraft Discord for about 20 mates. Keep it chill and simple. We need somewhere to chat, show builds, one general voice channel and occasional events. No tickets, no massive staff structure.',
    required: ['general', 'minecraft-chat', 'build-showcase', 'voice', 'events'],
    forbidden: ['tickets', 'support', 'large-staff', 'vip', 'tournaments', 'player-recruitment'],
    minimumVoice: 1,
    exactVoice: 1,
    maxResources: 8,
  },
  {
    id: 2,
    label: 'Large professional Minecraft',
    type: 'Gaming',
    prompt: 'I need a professional public Minecraft Discord for around 2,000 members. We run weekly tournaments, have a staff team, need applications, support tickets, announcements, several voice channels, a media section and team areas.',
    required: ['general', 'minecraft-chat', 'tournaments', 'staff', 'applications', 'tickets', 'announcements', 'voice', 'media', 'teams'],
    forbidden: ['vip', 'monetisation', 'player-recruitment', 'unrelated-games', 'separate-support'],
    minimumVoice: 2,
    maxResources: 35,
  },
  {
    id: 3,
    label: 'Explicit exclusions',
    type: 'Gaming',
    prompt: 'Make me a gaming community server for around 100 people. We mainly play Minecraft and Rocket League. We want general chat, game channels, voice channels and occasional events. Do not add tickets, applications, staff recruitment, economy systems or premium/VIP roles.',
    required: ['general', 'minecraft-chat', 'rocket-league-chat', 'voice', 'events'],
    forbidden: ['tickets', 'applications', 'staff-recruitment', 'economy', 'vip', 'premium'],
    minimumVoice: 1,
    maxResources: 18,
  },
  {
    id: 4,
    label: 'Messy natural language',
    type: 'Gaming',
    prompt: "yo basically me and a bunch of people are making a server, probably like 60 or 70 people, we play minecraft mostly but sometimes other stuff too. want it to feel active but not like one of those huge public servers. probably need chat, some vcs, somewhere for screenshots/builds and maybe events. don't overdo it",
    required: ['general', 'minecraft-chat', 'build-showcase', 'voice'],
    forbidden: ['tickets', 'applications', 'tournaments', 'vip', 'large-staff'],
    minimumVoice: 1,
    maxResources: 14,
  },
  {
    id: 5,
    label: 'Minimal server',
    type: 'Gaming',
    prompt: 'I only want the essentials for a small private gaming server of 15 people. General chat, one voice channel and one channel for sharing clips. Nothing else.',
    required: ['general', 'voice', 'clips'],
    forbidden: ['rules', 'support', 'tickets', 'applications', 'staff', 'events', 'tournaments', 'vip', 'announcements'],
    minimumVoice: 1,
    exactVoice: 1,
    maxResources: 3,
  },
  {
    id: 6,
    label: 'Complex multi-feature server',
    type: 'Gaming',
    prompt: 'Create a community Discord for about 800 members. We host regular gaming events and tournaments, have moderators and staff, need applications, support tickets, announcements, several game areas, voice channels, media sharing, suggestions and a place for event information.',
    required: ['general', 'events', 'tournaments', 'moderator', 'applications', 'tickets', 'announcements', 'voice', 'media', 'suggestions', 'event-information'],
    forbidden: ['vip', 'monetisation', 'unrelated-games'],
    minimumVoice: 2,
    maxResources: 38,
  },
  {
    id: 7,
    label: 'Creator community',
    type: 'Creator',
    prompt: 'I run a content creator community with around 300 members. I need announcements, general discussion, content sharing, feedback, collaboration, creator resources and a few voice channels. I also want a simple application area for people who want to join the creator team.',
    required: ['announcements', 'general', 'content-sharing', 'feedback', 'collaboration', 'creator-resources', 'voice', 'creator-applications'],
    forbidden: ['vip', 'monetisation', 'premium', 'gaming', 'unrelated-recruitment'],
    minimumVoice: 2,
    maxResources: 28,
  },
  {
    id: 8,
    label: 'Staff, applications, and support',
    type: 'Community',
    prompt: "This is a public community of roughly 500 members. We have a real staff team and need staff applications, member support tickets, announcements, general discussion, moderation channels and several voice channels. Keep the member-facing side clean and don't add unnecessary systems.",
    required: ['staff', 'staff-applications', 'tickets', 'announcements', 'general', 'moderation', 'voice'],
    forbidden: ['economy', 'xp', 'vip', 'tournaments', 'games', 'unnecessary-engagement'],
    minimumVoice: 2,
    maxResources: 24,
  },
  {
    id: 9,
    label: 'Events but not tournaments',
    type: 'Community',
    prompt: 'We have a 150-member community. We sometimes run community events like movie nights, game nights and Q&As. We need an events area and announcements, but we are NOT a competitive gaming server and do not need tournaments, teams or player recruitment.',
    required: ['events', 'announcements', 'general'],
    forbidden: ['tournaments', 'teams', 'player-recruitment', 'competitive'],
    maxResources: 14,
  },
  {
    id: 10,
    label: 'Ambiguous but reasonable',
    type: 'Community',
    prompt: 'I want a Discord for a growing online community of around 250 people. We need somewhere for people to talk, keep important information organised, let members share things, and occasionally run community activities. Keep it professional but friendly.',
    required: ['general', 'information', 'sharing', 'events'],
    forbidden: ['tickets', 'applications', 'economy', 'vip', 'tournaments', 'unrelated-games', 'large-staff'],
    maxResources: 16,
  },
];

const repeatedPromptIds = new Set([1, 2, 5, 8, 10]);
export const requestDelayMs = 12_000;
export const modelDelayMs = 30_000;
export const minimumRankableValidResponses = 15;

export function markdownDestinationFor(destination: string) {
  return destination.replace(/-results\.json$/i, '-report.md').replace(/\.json$/i, '.md');
}
const planKeys = ['type', 'description', 'categories', 'voiceCategories', 'recommendedFeatures', 'requestedFeatures', 'skippedFeatures', 'roles', 'rules'];
const categoryKeys = ['name', 'channels'];
const roleKeys = ['name', 'purpose', 'color', 'permissions', 'permissionsValue', 'kind', 'recommended', 'explicitlyRequested'];

export function taskSequence() {
  return scenarios.flatMap((scenario) => Array.from(
    { length: repeatedPromptIds.has(scenario.id) ? 3 : 1 },
    (_, index) => ({ scenario, repeat: index + 1 }),
  ));
}

export function resolveCatalogModels(catalog: ProviderCatalog) {
  const byId = new Map(catalog.filter((item): item is { id: string; name?: string } => typeof item.id === 'string').map((item) => [item.id, item]));
  return {
    available: models.filter((model) => byId.has(model.id)).map((model) => ({
      ...model,
      catalogName: byId.get(model.id)?.name ?? model.name,
    })),
    unavailable: models.filter((model) => !byId.has(model.id)).map((model) => ({
      ...model,
      reason: 'Exact pinned model ID is absent from the configured provider catalog; no substitute was used.',
    })),
  };
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function unknownFieldPaths(value: unknown, allowed: string[], prefix: string): string[] {
  const record = object(value);
  return record ? Object.keys(record).filter((key) => !allowed.includes(key)).map((key) => `${prefix}${key}`) : [];
}

export function inspectSchema(value: unknown) {
  const proposal = object(value);
  const required: string[] = [];
  const unsupported: string[] = [];
  if (!proposal) {
    return { unsupportedFields: [], missingRequiredFields: [...planKeys] };
  }
  unsupported.push(...unknownFieldPaths(proposal, planKeys, ''));
  for (const key of planKeys) if (!(key in proposal)) required.push(key);
  for (const key of ['categories', 'voiceCategories', 'roles', 'rules', 'recommendedFeatures', 'requestedFeatures', 'skippedFeatures']) {
    if (!Array.isArray(proposal[key])) required.push(`${key}:array`);
  }
  for (const [key, array] of [['categories', proposal.categories], ['voiceCategories', proposal.voiceCategories]] as const) {
    if (!Array.isArray(array)) continue;
    array.forEach((item, index) => {
      unsupported.push(...unknownFieldPaths(item, categoryKeys, `${key}[${index}].`));
      const entry = object(item);
      if (!entry?.name) required.push(`${key}[${index}].name`);
      if (!Array.isArray(entry?.channels)) required.push(`${key}[${index}].channels`);
    });
  }
  if (Array.isArray(proposal.roles)) {
    proposal.roles.forEach((item, index) => {
      unsupported.push(...unknownFieldPaths(item, roleKeys, `roles[${index}].`));
      const entry = object(item);
      for (const key of roleKeys) if (!entry || !(key in entry)) required.push(`roles[${index}].${key}`);
    });
  }
  return {
    unsupportedFields: [...new Set(unsupported)],
    missingRequiredFields: [...new Set(required)],
  };
}

function cleanName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function flattenPlan(value: unknown) {
  const plan = object(value) ?? {};
  const categories = Array.isArray(plan.categories) ? plan.categories.map(object).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  const voiceCategories = Array.isArray(plan.voiceCategories) ? plan.voiceCategories.map(object).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  const roles = Array.isArray(plan.roles) ? plan.roles.map(object).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
  const toStrings = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string') : [];
  return {
    channels: categories.flatMap((category) => toStrings(category.channels)),
    voiceChannels: voiceCategories.flatMap((category) => toStrings(category.channels)),
    roles: roles.map((role) => typeof role.name === 'string' ? role.name : ''),
    categories: categories.map((category) => typeof category.name === 'string' ? category.name : ''),
    rules: toStrings(plan.rules),
  };
}

function matchingFeature(plan: ReturnType<typeof flattenPlan>, feature: string) {
  const content = [...plan.channels, ...plan.voiceChannels, ...plan.roles].map(cleanName);
  const matcher: Record<string, RegExp> = {
    'minecraft-chat': /minecraft/,
    'rocket-league-chat': /rocket-league/,
    'build-showcase': /build|showcase/,
    voice: /.+/,
    staff: /staff|moderator|mod/,
    moderator: /moderator|mod/,
    applications: /application/,
    'staff-applications': /staff-application/,
    'creator-applications': /creator-application|team-application/,
    tickets: /ticket/,
    'separate-support': /^support(?:-chat|-desk|-information)?$/,
    moderation: /mod|moderation/,
    announcements: /announcement/,
    media: /media|content|video|clip/,
    'content-sharing': /content|video|media|sharing/,
    collaboration: /collab|partner/,
    'creator-resources': /resource|guide|tool/,
    'match-discussion': /match|football-chat|discussion/,
    fixtures: /fixture|schedule/,
    'player-discussion': /player|football/,
    'event-information': /event|schedule|information/,
    suggestions: /suggestion|feedback/,
    information: /information|announcement|rules|faq|start-here/,
    sharing: /sharing|media|content|photo|image|video/,
    events: /event|activity|game-night|movie-night|q-and-a/,
  };
  if (feature === 'voice') return plan.voiceChannels.length > 0;
  if (feature === 'large-staff') return plan.roles.some((role) => /staff|moderator|admin/i.test(role));
  const expression = matcher[feature];
  return content.some((value) => expression ? expression.test(value) : value.includes(cleanName(feature)));
}

function violates(plan: ReturnType<typeof flattenPlan>, scenario: Scenario) {
  const all = [...plan.channels, ...plan.voiceChannels, ...plan.roles, ...plan.categories].map(cleanName);
  const violations = scenario.forbidden.filter((feature) => {
    if (feature === 'large-staff') return plan.roles.some((role) => /admin|staff|moderator/i.test(role));
    if (feature === 'games') return plan.channels.some((channel) => /(?:minecraft|fortnite|valorant|league-of-legends|apex|rocket-league|overwatch)/i.test(channel));
    if (feature === 'unrelated-games') {
      const requestedGames = ['minecraft', 'rocket league'].filter((game) => scenario.prompt.toLowerCase().includes(game));
      return plan.channels.some((channel) => {
        const lower = cleanName(channel);
        return ['minecraft', 'fortnite', 'valorant', 'league-of-legends', 'apex-legends', 'rocket-league', 'overwatch']
          .some((game) => lower.includes(game) && !requestedGames.some((requested) => cleanName(requested) === game));
      });
    }
    if (feature === 'staff-recruitment') return plan.channels.some((channel) => /staff-recruit|staff-application/i.test(channel));
    if (feature === 'unrelated-recruitment') return plan.channels.some((channel) => /player-recruit|team-recruit|tryout/i.test(channel));
    if (feature === 'separate-support') return plan.channels.some((channel) =>
      /^support(?:-chat|-desk|-information)?$/i.test(cleanName(channel)));
    if (feature === 'large-staff') return plan.roles.some((role) => /admin|staff|moderator/i.test(role)) && /no massive staff/i.test(scenario.prompt);
    if (feature === 'unnecessary-engagement') return plan.channels.some((channel) => /xp|level|leaderboard|reaction-role|bot-command/i.test(channel));
    if (feature === 'competitive') return plan.channels.some((channel) => /tournament|scrim|team|recruit|match-results/i.test(channel));
    if (feature === 'monetisation') return all.some((value) => /vip|premium|donor|booster|paid|sponsor|shop|store/.test(value));
    return all.some((value) => value.includes(cleanName(feature)));
  });
  if (!/\b(?:vip|premium|supporter|donor|booster|paid|sponsor|monetiz)\b/i.test(scenario.prompt)
    && all.some((value) => /\b(vip|premium|supporter|donor|booster|paid|sponsor|subscription)\b/.test(value))) {
    violations.push('invented-vip-or-monetisation');
  }
  return [...new Set(violations)];
}

function featuresScore(plan: ReturnType<typeof flattenPlan>, scenario: Scenario) {
  const missing = scenario.required.filter((feature) => !matchingFeature(plan, feature));
  const forbidden = violates(plan, scenario);
  const coverage = 1 - missing.length / Math.max(1, scenario.required.length);
  const exclusionRate = 1 - forbidden.length / Math.max(1, scenario.forbidden.length);
  const resources = plan.channels.length + plan.voiceChannels.length;
  const excess = scenario.maxResources === undefined ? 0 : Math.max(0, resources - scenario.maxResources);
  const ratio = scenario.maxResources ? Math.min(1, excess / Math.max(1, scenario.maxResources)) : 0;
  const voiceCountOkay = (scenario.minimumVoice === undefined || plan.voiceChannels.length >= scenario.minimumVoice)
    && (scenario.exactVoice === undefined || plan.voiceChannels.length === scenario.exactVoice);
  const hallucinatedChannels = plan.channels.filter((channel) => !scenario.required.some((required) =>
    cleanName(channel).includes(cleanName(required)) || cleanName(required).includes(cleanName(channel))));
  const hallucinatedRoles = plan.roles.filter((role) => !/owner|member/i.test(role)
    && !scenario.required.some((required) => cleanName(role).includes(cleanName(required))
      || required === 'staff' && /staff|moderator|mod/i.test(role)));
  const critical = missing.length >= Math.ceil(scenario.required.length / 2)
    || forbidden.some((item) => ['tickets', 'support', 'tournaments', 'vip', 'premium', 'economy', 'staff-recruitment', 'player-recruitment'].includes(item))
    || !voiceCountOkay && scenario.exactVoice !== undefined;
  const severity: Attempt['severity'] = critical ? 'critical'
    : forbidden.length > 1 || missing.length >= 2 || excess > 6 ? 'major'
      : forbidden.length || missing.length || hallucinatedChannels.length + hallucinatedRoles.length > 0 ? 'minor' : 'none';
  const readableNames = [...plan.channels, ...plan.voiceChannels].filter((name) => /^[a-z0-9][a-z0-9 -]{0,50}$/i.test(name)).length;
  const naturalness = plan.channels.length + plan.voiceChannels.length
    ? Math.max(0, Math.min(10, 10 - Math.max(0, plan.channels.length + plan.voiceChannels.length - readableNames) * 0.4))
    : 0;
  return {
    scores: {
      intentUnderstanding: round(10 * (0.75 * coverage + 0.25 * (voiceCountOkay ? 1 : 0))),
      instructionFollowing: round(Math.max(0, 10 * coverage - forbidden.length * 2)),
      exclusionHandling: round(10 * exclusionRate),
      hallucinationControl: round(Math.max(0, 10 - forbidden.length * 2.5 - hallucinatedChannels.length * 0.75
        - hallucinatedRoles.length * 1.5 - (plan.categories.length > Math.min(10, Math.max(4, Math.ceil((scenario.maxResources ?? 20) / 2))) ? 1.5 : 0))),
      proportionality: round(Math.max(0, 10 - ratio * 10 - Math.max(0, plan.categories.length - 8))),
      taskCompletion: round(10 * coverage * (voiceCountOkay ? 1 : 0.8)),
      relevance: round(Math.max(0, 10 - Math.max(0, hallucinatedChannels.length - 2) - hallucinatedRoles.length)),
      naturalness: round(naturalness),
    },
    missing,
    violations: forbidden,
    inventedChannel: hallucinatedChannels.length > 0,
    inventedCategory: plan.categories.length > Math.min(10, Math.max(4, Math.ceil((scenario.maxResources ?? 20) / 2))),
    inventedRole: hallucinatedRoles.length > 0,
    inventedGame: forbidden.some((item) => item.includes('game')),
    inventedMonetisation: forbidden.some((item) => /monetisation|vip|premium|economy/.test(item)),
    inventedVip: forbidden.some((item) => /vip/.test(item)),
    inventedRecruitment: forbidden.some((item) => /recruitment/.test(item)),
    inventedSupportOrTickets: forbidden.some((item) => /tickets|support/.test(item)),
    inventedTournament: forbidden.some((item) => /tournament|competitive/.test(item)),
    ignoredExplicitRequest: missing.length > 0,
    violatedExplicitExclusion: forbidden.length > 0,
    excessiveScale: excess > 0,
    insufficientScale: resources < Math.max(1, scenario.required.length - 2),
    severity,
  };
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function emptyFlags(): ErrorFlags {
  return {
    inventedChannel: false,
    inventedCategory: false,
    inventedRole: false,
    inventedGame: false,
    inventedMonetisation: false,
    unsafePermissionEscalation: false,
    inventedVip: false,
    inventedRecruitment: false,
    inventedSupportOrTickets: false,
    inventedTournament: false,
    ignoredExplicitRequest: false,
    violatedExplicitExclusion: false,
    excessiveScale: false,
    insufficientScale: false,
    malformedJson: false,
    schemaValidationFailure: false,
  };
}

function structuralFingerprint(plan: SetupPlan) {
  const structure = flattenPlan(plan);
  return JSON.stringify({
    channels: structure.channels.map(cleanName).sort(),
    voice: structure.voiceChannels.map(cleanName).sort(),
    roles: structure.roles.map(cleanName).sort(),
    categories: structure.categories.map(cleanName).sort(),
    rules: structure.rules.map((rule) => rule.trim().toLowerCase()).sort(),
  });
}

function classification(error: unknown, status?: number): { kind: FailureKind; message: string } {
  if (status === 429) return { kind: 'rate_limit', message: 'Provider rate limit (HTTP 429).' };
  if (status && status >= 400) return { kind: 'provider_error', message: `Provider returned HTTP ${status}.` };
  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (/timeout|abort/i.test(name) || /timeout/i.test(message)) return { kind: 'timeout', message: 'Provider request timed out.' };
  if (/SyntaxError|JSON|unexpected token|end of JSON/i.test(`${name} ${message}`)) {
    return { kind: 'malformed_json', message: 'Provider returned malformed JSON.' };
  }
  return { kind: 'provider_error', message: 'Provider request failed; see sanitized status/category.' };
}

export async function productionReconcile(model: Model, scenario: Scenario, rawText: string): Promise<{
  plan: SetupPlan;
  accepted: boolean;
  warning?: string;
}> {
  const old = {
    fetch: globalThis.fetch,
    apiKey: process.env.AI_API_KEY,
    model: process.env.AI_MODEL,
    baseUrl: process.env.AI_BASE_URL,
    warn: console.warn,
  };
  const warnings: string[] = [];
  process.env.AI_API_KEY = 'benchmark-reconciliation-mock';
  process.env.AI_MODEL = model.id;
  process.env.AI_BASE_URL = 'https://benchmark-reconciliation.invalid/v1';
  console.warn = (message?: unknown) => { warnings.push(typeof message === 'string' ? message : 'Production planner warning.'); };
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: rawText } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const plan = await generateSetupPlan(scenario.type, scenario.prompt);
    return { plan, accepted: warnings.length === 0, warning: warnings[0] };
  } finally {
    globalThis.fetch = old.fetch;
    console.warn = old.warn;
    for (const [key, value] of Object.entries({
      AI_API_KEY: old.apiKey,
      AI_MODEL: old.model,
      AI_BASE_URL: old.baseUrl,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function liveCatalog(): Promise<ProviderCatalog> {
  const baseUrl = process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Provider catalog returned HTTP ${response.status}.`);
  const body = await response.json() as { data?: ProviderCatalog };
  return body.data ?? [];
}

async function liveSend(model: Model, scenario: Scenario): Promise<RawResponse> {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) throw new Error('AI_API_KEY is not configured.');
  const baseUrl = process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const provider = new OpenAiCompatibleProvider(apiKey, model.id, baseUrl);
  const requestStart = Date.now();
  let providerStatus = 0;
  let rawContent: string | null = null;
  let responseBodyText: string | null = null;
  let sentPayload: Record<string, unknown> | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (init?.body && typeof init.body === 'string') {
      try {
        sentPayload = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        sentPayload = undefined;
      }
    }
    const response = await originalFetch(input, init);
    providerStatus = response.status;
    if (response.ok) {
      try {
        responseBodyText = await response.clone().text();
        const body = JSON.parse(responseBodyText) as { choices?: Array<{ message?: { content?: unknown } }> };
        const content = body.choices?.[0]?.message?.content;
        if (typeof content === 'string') rawContent = content;
      } catch (error) {
        rawContent = null;
      }
    }
    return response;
  };
  try {
    const proposal = await provider.generatePlan({
      type: scenario.type,
      description: scenario.prompt,
      intent: extractSetupIntent(scenario.type, scenario.prompt),
      fallbackPlan: createSetupPlan(scenario.type, scenario.prompt),
    });
    if (!sentPayload || typeof sentPayload.temperature !== 'number' || sentPayload.temperature !== 0.2) {
      throw new Error('Provider request did not preserve benchmark settings.');
    }
    const messages = Array.isArray(sentPayload.messages) ? sentPayload.messages as Array<Record<string, unknown>> : [];
    return {
      bodyText: JSON.stringify({ proposal }),
      rawContent,
      rawProposal: proposal,
      httpStatus: providerStatus,
      latencyMs: Date.now() - requestStart,
      request: {
        model: model.id,
        type: scenario.type,
        prompt: scenario.prompt,
        temperature: 0.2,
        responseFormat: { type: 'json_object' },
        systemPrompt: typeof messages[0]?.content === 'string' ? messages[0].content : '',
        userPayload: typeof messages[1]?.content === 'string' ? messages[1].content : '',
      },
    };
  } catch (error) {
    const messages = Array.isArray(sentPayload?.messages) ? sentPayload.messages as Array<Record<string, unknown>> : [];
    const request = {
      model: model.id,
      type: scenario.type,
      prompt: scenario.prompt,
      temperature: 0.2 as const,
      responseFormat: { type: 'json_object' as const },
      systemPrompt: typeof messages[0]?.content === 'string' ? messages[0].content : '',
      userPayload: typeof messages[1]?.content === 'string' ? messages[1].content : '',
    };
    if (providerStatus >= 400) {
      const failure = classification(error, providerStatus);
      throw Object.assign(new Error(failure.message), {
        kind: failure.kind,
        status: providerStatus,
        latencyMs: Date.now() - requestStart,
        rawContent: rawContent ?? responseBodyText,
        request,
      });
    }
    throw Object.assign(error instanceof Error ? error : new Error('Provider request failed.'), {
      latencyMs: Date.now() - requestStart,
      rawContent: rawContent ?? responseBodyText,
      status: providerStatus,
      request,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function attemptFromFailure(model: Model, scenario: Scenario, repeat: number, error: unknown): Attempt {
  const record = object(error) ?? {};
  const status = typeof record.status === 'number' ? record.status : undefined;
  const classified = record.kind && ['rate_limit', 'timeout', 'provider_error', 'malformed_json', 'missing_content'].includes(String(record.kind))
    ? { kind: record.kind as FailureKind, message: error instanceof Error ? error.message : 'Provider error.' }
    : classification(error, status);
  const fallback = createSetupPlan(scenario.type, scenario.prompt);
  const final = featuresScore(flattenPlan(fallback), scenario);
  return {
    model,
    promptId: scenario.id,
    repeat,
    attempted: true,
    source: 'FALLBACK',
    providerResponseReceived: classified.kind === 'malformed_json' || (status !== undefined && status < 400),
    ...(status === undefined ? {} : { httpStatus: status }),
    failureKind: classified.kind,
    failureMessage: classified.message,
    ...(typeof record.latencyMs === 'number' ? { latencyMs: record.latencyMs } : {}),
    ...(typeof record.rawContent === 'string' ? { rawResponseText: record.rawContent } : {}),
    ...(object(record.request) ? { request: record.request as RawResponse['request'] } : {}),
    jsonValid: false,
    schemaValidation: 'not-run',
    schemaDiagnostics: { unsupportedFields: [], missingRequiredFields: [] },
    reconciliation: 'fallback',
    fallbackReason: classified.kind,
    finalPlan: fallback,
    finalScores: final.scores,
    errors: { ...emptyFlags(), malformedJson: classified.kind === 'malformed_json' },
    severity: classified.kind === 'malformed_json' ? 'critical' : 'none',
  };
}

function makeAttempt(
  model: Model,
  scenario: Scenario,
  repeat: number,
  response: RawResponse,
  parsed: unknown,
  reconciliation: Awaited<ReturnType<typeof productionReconcile>>,
  parseValid: boolean,
) {
  const rawPlan = object(parsed);
  const diagnostics = inspectSchema(parsed);
  const schemaPass = parseValid && reconciliation.accepted;
  const rawScore = rawPlan ? featuresScore(flattenPlan(parsed as SetupPlan), scenario) : undefined;
  const roles = Array.isArray(rawPlan?.roles) ? rawPlan.roles : [];
  const unsafePermissionEscalation = roles.some((role) => {
    const permissions = object(role)?.permissions;
    return Array.isArray(permissions) && permissions.some((permission) =>
      typeof permission === 'string' && /administrator|manageguild|manageroles|managechannels/i.test(permission));
  });
  const finalScore = featuresScore(flattenPlan(reconciliation.plan), scenario);
  const errors = rawScore
    ? {
      ...emptyFlags(),
      inventedChannel: rawScore.inventedChannel,
      inventedCategory: rawScore.inventedCategory,
      inventedRole: rawScore.inventedRole,
      inventedGame: rawScore.inventedGame,
      inventedMonetisation: rawScore.inventedMonetisation,
      unsafePermissionEscalation,
      inventedVip: rawScore.inventedVip,
      inventedRecruitment: rawScore.inventedRecruitment,
      inventedSupportOrTickets: rawScore.inventedSupportOrTickets,
      inventedTournament: rawScore.inventedTournament,
      ignoredExplicitRequest: rawScore.ignoredExplicitRequest,
      violatedExplicitExclusion: rawScore.violatedExplicitExclusion,
      excessiveScale: rawScore.excessiveScale,
      insufficientScale: rawScore.insufficientScale,
      malformedJson: false,
      schemaValidationFailure: !schemaPass,
    }
    : { ...emptyFlags(), malformedJson: !parseValid, schemaValidationFailure: !schemaPass };
  const productionFallback = !schemaPass;
  const changed = schemaPass && structuralFingerprint(parsed as SetupPlan) !== structuralFingerprint(reconciliation.plan);
  return {
    model,
    promptId: scenario.id,
    repeat,
    attempted: true,
    source: productionFallback ? 'FALLBACK' as const : 'AI' as const,
    providerResponseReceived: true,
    httpStatus: response.httpStatus,
    latencyMs: response.latencyMs,
    rawResponseText: response.rawContent ?? response.bodyText,
    rawProposal: parsed,
    jsonValid: parseValid,
    schemaValidation: schemaPass ? 'pass' as const : 'fail' as const,
    schemaDiagnostics: diagnostics,
    reconciliation: productionFallback ? 'fallback' as const : changed ? 'changed' as const : 'clean' as const,
    ...(productionFallback ? { fallbackReason: reconciliation.warning ?? 'Malformed or schema-invalid proposal.' } : {}),
    finalPlan: reconciliation.plan,
    request: response.request,
    ...(rawScore ? { rawScores: { ...rawScore.scores, severity: rawScore.severity } } : {}),
    finalScores: finalScore.scores,
    errors,
    severity: !parseValid || !schemaPass || unsafePermissionEscalation
      ? 'critical' as const
      : rawScore?.severity ?? 'major' as const,
  } satisfies Attempt;
}

export async function runBenchmark(hooks: Hooks, destination?: string) {
  const catalog = await hooks.catalog();
  const resolution = resolveCatalogModels(catalog);
  const attempts: Attempt[] = [];
  const sequence = taskSequence();
  let completedModelCount = 0;
  for (const model of resolution.available) {
    if (completedModelCount > 0) await hooks.sleep(modelDelayMs);
    let consecutiveRateLimits = 0;
    for (let taskIndex = 0; taskIndex < sequence.length; taskIndex += 1) {
      const task = sequence[taskIndex]!;
      if (consecutiveRateLimits >= 3) {
        const fallback = createSetupPlan(task.scenario.type, task.scenario.prompt);
        const final = featuresScore(flattenPlan(fallback), task.scenario);
        const skipped: Attempt = {
          model,
          promptId: task.scenario.id,
          repeat: task.repeat,
          attempted: false,
          source: 'FALLBACK',
          providerResponseReceived: false,
          skipReason: 'Skipped remaining requests after three consecutive HTTP 429 responses.',
          jsonValid: false,
          schemaValidation: 'not-run',
          schemaDiagnostics: { unsupportedFields: [], missingRequiredFields: [] },
          reconciliation: 'fallback',
          fallbackReason: 'Rate-limit circuit breaker',
          finalPlan: fallback,
          finalScores: final.scores,
          errors: emptyFlags(),
          severity: 'none',
        };
        attempts.push(skipped);
        await hooks.onAttempt?.(skipped);
        if (destination) await writeFile(destination, JSON.stringify(jsonReport(attempts, resolution), null, 2), { mode: 0o600 });
        continue;
      }
      if (taskIndex > 0) await hooks.sleep(requestDelayMs);
      let attempt: Attempt;
      try {
        const response = await hooks.send(model, task.scenario, task.repeat);
        let parsed: unknown;
        const content = response.rawContent ?? response.bodyText;
        try {
          const normalized = content.trim()
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/, '');
          parsed = JSON.parse(normalized);
          if (object(parsed)?.proposal && Object.keys(object(parsed)!).length === 1) parsed = (parsed as { proposal: unknown }).proposal;
        } catch {
          const reconciliation = await hooks.reconcile(model, task.scenario, undefined, content);
          attempt = {
            ...makeAttempt(model, task.scenario, task.repeat, response, undefined, reconciliation, false),
            failureKind: 'malformed_json',
            failureMessage: 'Model returned malformed JSON.',
          };
          consecutiveRateLimits = 0;
          attempts.push(attempt);
          await hooks.onAttempt?.(attempt);
          if (destination) await writeFile(destination, JSON.stringify(jsonReport(attempts, resolution), null, 2), { mode: 0o600 });
          continue;
        }
        const rawText = response.rawContent ?? JSON.stringify(parsed);
        const reconciliation = await hooks.reconcile(model, task.scenario, parsed, rawText);
        attempt = makeAttempt(model, task.scenario, task.repeat, response, parsed, reconciliation, true);
      } catch (error) {
        attempt = attemptFromFailure(model, task.scenario, task.repeat, error);
      }
      consecutiveRateLimits = attempt.failureKind === 'rate_limit' ? consecutiveRateLimits + 1 : 0;
      attempts.push(attempt);
      await hooks.onAttempt?.(attempt);
      if (destination) await writeFile(destination, JSON.stringify(jsonReport(attempts, resolution), null, 2), { mode: 0o600 });
    }
    completedModelCount += 1;
  }
  const report = jsonReport(attempts, resolution);
  if (destination) {
    await writeFile(destination, JSON.stringify(report, null, 2), { mode: 0o600 });
    await writeFile(markdownDestinationFor(destination), markdownReport(report), { mode: 0o600 });
  }
  return report;
}

function median(numbers: number[]) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function consistencyFor(attempts: Attempt[], final: boolean) {
  const scores: Array<{ promptId: number; consistency: number | null; outputs: number; contradictions: number }> = [];
  for (const promptId of repeatedPromptIds) {
    const candidates = attempts.filter((attempt) => attempt.promptId === promptId
      && (final ? attempt.attempted : attempt.rawProposal !== undefined));
    const plans = candidates.map((attempt) => final ? attempt.finalPlan : attempt.rawProposal as SetupPlan);
    const resourceSets = plans.map((plan) => {
      const flat = flattenPlan(plan);
      return new Set([...flat.channels.map(cleanName), ...flat.voiceChannels.map((name) => `voice:${cleanName(name)}`), ...flat.roles.map((name) => `role:${cleanName(name)}`)]);
    });
    const agreements: number[] = [];
    for (let left = 0; left < resourceSets.length; left += 1) {
      for (let right = left + 1; right < resourceSets.length; right += 1) {
        const union = new Set([...resourceSets[left]!, ...resourceSets[right]!]);
        const intersection = [...resourceSets[left]!].filter((item) => resourceSets[right]!.has(item)).length;
        agreements.push(union.size ? intersection / union.size : 1);
      }
    }
    scores.push({
      promptId,
      consistency: agreements.length ? round(10 * agreements.reduce((sum, value) => sum + value, 0) / agreements.length) : null,
      outputs: plans.length,
      contradictions: candidates.filter((attempt) => attempt.severity === 'critical').length,
    });
  }
  const measured = scores.map((entry) => entry.consistency).filter((value): value is number => value !== null);
  return {
    prompts: scores,
    overall: measured.length ? round(measured.reduce((sum, value) => sum + value, 0) / measured.length) : null,
    worst: measured.length ? Math.min(...measured) : null,
    majorContradictions: scores.reduce((sum, item) => sum + item.contradictions, 0),
  };
}

function summarizeModel(model: Model, attempts: Attempt[]) {
  const tried = attempts.filter((attempt) => attempt.attempted);
  const received = tried.filter((attempt) => attempt.providerResponseReceived);
  const parsed = received.filter((attempt) => attempt.jsonValid);
  const schemaValid = parsed.filter((attempt) => attempt.schemaValidation === 'pass');
  const rawAttempts = attempts.filter((attempt) => attempt.rawScores);
  const rawAvg = (key: string) => rawAttempts.length
    ? round(rawAttempts.reduce((sum, item) => {
      const value = item.rawScores?.[key];
      return sum + (typeof value === 'number' ? value : 0);
    }, 0) / rawAttempts.length)
    : null;
  const consistency = consistencyFor(attempts, false);
  const finalConsistency = consistencyFor(attempts, true);
  const quality = {
    intentUnderstanding: rawAvg('intentUnderstanding'),
    instructionFollowing: rawAvg('instructionFollowing'),
    exclusionHandling: rawAvg('exclusionHandling'),
    hallucinationControl: rawAvg('hallucinationControl'),
    proportionality: rawAvg('proportionality'),
    taskCompletion: rawAvg('taskCompletion'),
    consistency: consistency.overall,
    structuredJson: received.length ? round(10 * schemaValid.length / received.length) : null,
    naturalness: rawAvg('naturalness'),
  };
  const rawOverall = Object.values(quality).some((value) => value === null)
    ? null
    : round(quality.intentUnderstanding! * 2 + quality.instructionFollowing! * 1.5 + quality.exclusionHandling! * 1.5
      + quality.hallucinationControl! + quality.proportionality! + quality.taskCompletion!
      + quality.consistency! + quality.structuredJson! * 0.5 + quality.naturalness! * 0.5);
  const errors = attempts.reduce<Record<string, number>>((counts, attempt) => {
    if (attempt.failureKind) counts[attempt.failureKind] = (counts[attempt.failureKind] ?? 0) + 1;
    for (const [key, value] of Object.entries(attempt.errors)) if (value) counts[key] = (counts[key] ?? 0) + 1;
    if (attempt.schemaDiagnostics.unsupportedFields.length) counts.unsupportedFields = (counts.unsupportedFields ?? 0) + 1;
    if (attempt.schemaDiagnostics.missingRequiredFields.length) counts.missingRequiredFields = (counts.missingRequiredFields ?? 0) + 1;
    return counts;
  }, {});
  const finalAverage = (key: string) => attempts.length
    ? round(attempts.reduce((sum, item) => sum + (item.finalScores[key] ?? 0), 0) / attempts.length)
    : null;
  const latency = received.map((attempt) => attempt.latencyMs ?? 0);
  const fallbacks = attempts.filter((attempt) => attempt.reconciliation === 'fallback').length;
  const changed = attempts.filter((attempt) => attempt.reconciliation === 'changed').length;
  const clean = tried.filter((attempt) => attempt.reconciliation === 'clean').length;
  const severityCounts = tried.reduce<Record<string, number>>((counts, attempt) => {
    counts[attempt.severity] = (counts[attempt.severity] ?? 0) + 1;
    return counts;
  }, {});
  return {
    model,
    totalRequests: attempts.length,
    attemptedRequests: tried.length,
    skippedRequests: attempts.length - tried.length,
    successfulProviderResponses: received.length,
    availabilityPercent: round(100 * received.length / Math.max(1, tried.length)),
    parsedJsonResponses: parsed.length,
    schemaValidProposals: schemaValid.length,
    fallbacks,
    plansRequiringReconciliation: changed,
    plansAcceptedCleanly: clean,
    rawQualityRankable: schemaValid.length >= minimumRankableValidResponses,
    rawQuality: quality,
    rawOverall,
    consistency,
    finalServerPilot: {
      intentUnderstanding: finalAverage('intentUnderstanding'),
      instructionFollowing: finalAverage('instructionFollowing'),
      exclusionHandling: finalAverage('exclusionHandling'),
      hallucinationControl: finalAverage('hallucinationControl'),
      proportionality: finalAverage('proportionality'),
      taskCompletion: finalAverage('taskCompletion'),
      consistency: finalConsistency.overall,
      validFinalPlans: attempts.length,
      fallbackCount: fallbacks,
      reconciliationCount: changed,
    },
    errorCounts: errors,
    severityCounts,
    latency: {
      averageMs: latency.length ? Math.round(latency.reduce((sum, value) => sum + value, 0) / latency.length) : null,
      medianMs: median(latency),
      slowestMs: latency.length ? Math.max(...latency) : null,
    },
  };
}

export function jsonReport(attempts: Attempt[], resolution: ReturnType<typeof resolveCatalogModels>) {
  const summaries = resolution.available.map((model) => summarizeModel(model, attempts.filter((attempt) => attempt.model.id === model.id)));
  const expected = resolution.available.length * taskSequence().length;
  return {
    benchmark: 'ServerPilot AI model benchmark round 2',
    generatedAt: new Date().toISOString(),
    status: attempts.length === expected ? 'complete' : 'partial',
    provider: 'Configured AI-compatible provider; exact model IDs only; no openrouter/free router alias.',
    settings: {
      temperature: 0.2,
      responseFormat: { type: 'json_object' },
      sequentialRequests: true,
      delayBetweenRequestsMs: requestDelayMs,
      delayBetweenModelsMs: modelDelayMs,
      requestTimeoutMs: 30_000,
      minimumRankableValidResponses,
    },
    promptHash: createHash('sha256').update(JSON.stringify(scenarios)).digest('hex'),
    modelsTested: resolution.available,
    unavailableModels: resolution.unavailable,
    scenarios,
    summaries,
    attempts,
  };
}

function ranking(summaries: ReturnType<typeof jsonReport>['summaries']) {
  const enough = summaries.filter((summary) => summary.rawQualityRankable && summary.rawOverall !== null);
  const fields: Array<[string, (summary: typeof summaries[number]) => number | null]> = [
    ['Best raw AI quality', (summary) => summary.rawOverall],
    ['Best instruction following', (summary) => summary.rawQuality.instructionFollowing],
    ['Best exclusion handling', (summary) => summary.rawQuality.exclusionHandling],
    ['Best hallucination control', (summary) => summary.rawQuality.hallucinationControl],
    ['Best proportionality', (summary) => summary.rawQuality.proportionality],
    ['Best task completion', (summary) => summary.rawQuality.taskCompletion],
    ['Most consistent', (summary) => summary.consistency.overall],
    ['Most reliable', (summary) => summary.availabilityPercent],
    ['Fastest', (summary) => summary.latency.medianMs],
    ['Best overall raw model', (summary) => summary.rawOverall],
    ['Best overall ServerPilot result', (summary) => summary.finalServerPilot.taskCompletion],
  ];
  return fields.map(([label, score]) => {
    const candidates = enough.map((summary) => ({ summary, score: score(summary) })).filter((item): item is { summary: typeof summaries[number]; score: number } => item.score !== null);
    if (!candidates.length) return `- **${label}:** INSUFFICIENT EVIDENCE`;
    candidates.sort((left, right) => right.score - left.score);
    return `- **${label}:** ${candidates[0]!.summary.model.name} (${round(candidates[0]!.score)})`;
  }).join('\n');
}

export function markdownReport(report: ReturnType<typeof jsonReport>) {
  const summaries = report.summaries;
  const lines = [
    '# ServerPilot AI Model Benchmark — Round 2',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Executive summary',
    '',
    `Status: ${report.status}. Models are ranked only with at least ${minimumRankableValidResponses} schema-valid raw proposals. The prompt instructions resolve to ${taskSequence().length} requests per model (five prompts repeated three times, the other five once).`,
    '',
    `Models with enough raw data: ${summaries.filter((summary) => summary.rawQualityRankable).map((summary) => summary.model.name).join(', ') || 'none; rankings will be INSUFFICIENT EVIDENCE'}.`,
    '',
    '## Provider availability',
    '',
    '| Model | Attempts | Provider responses | Parsed JSON | Schema-valid proposals | Fallbacks | HTTP 429 | Timeouts | Other errors |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summaries.map((summary) => `| ${summary.model.name} | ${summary.totalRequests} (${summary.attemptedRequests} sent, ${summary.skippedRequests} skipped) | ${summary.successfulProviderResponses} (${summary.availabilityPercent}%) | ${summary.parsedJsonResponses} | ${summary.schemaValidProposals} | ${summary.fallbacks} | ${summary.errorCounts.rate_limit ?? 0} | ${summary.errorCounts.timeout ?? 0} | ${summary.errorCounts.provider_error ?? 0} |`),
    '',
    '### Unavailable pinned models',
    '',
    ...(report.unavailableModels.length
      ? report.unavailableModels.map((model) => `- \`${model.id}\` — ${model.reason}`)
      : ['None.']),
    '',
    '## Raw model comparison',
    '',
    '| Model | Intent | Following | Exclusions | Hallucination control | Proportionality | Completion | Consistency | JSON/schema | Naturalness | Availability | Overall / 100 |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summaries.map((summary) => `| ${summary.model.name} | ${summary.rawQuality.intentUnderstanding ?? 'N/A'} | ${summary.rawQuality.instructionFollowing ?? 'N/A'} | ${summary.rawQuality.exclusionHandling ?? 'N/A'} | ${summary.rawQuality.hallucinationControl ?? 'N/A'} | ${summary.rawQuality.proportionality ?? 'N/A'} | ${summary.rawQuality.taskCompletion ?? 'N/A'} | ${summary.consistency.overall ?? 'N/A'} | ${summary.rawQuality.structuredJson ?? 'N/A'} | ${summary.rawQuality.naturalness ?? 'N/A'} | ${summary.availabilityPercent}% | ${summary.rawOverall ?? 'INSUFFICIENT EVIDENCE'} |`),
    '',
    '## Production ServerPilot comparison',
    '',
    '| Model | Final intent | Following | Exclusions | Hallucination control | Proportionality | Completion | Consistency | Fallbacks | Reconciled | Accepted cleanly |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...summaries.map((summary) => `| ${summary.model.name} | ${summary.finalServerPilot.intentUnderstanding} | ${summary.finalServerPilot.instructionFollowing} | ${summary.finalServerPilot.exclusionHandling} | ${summary.finalServerPilot.hallucinationControl} | ${summary.finalServerPilot.proportionality} | ${summary.finalServerPilot.taskCompletion} | ${summary.finalServerPilot.consistency ?? 'N/A'} | ${summary.fallbacks}/${taskSequence().length} | ${summary.plansRequiringReconciliation}/${taskSequence().length} | ${summary.plansAcceptedCleanly}/${taskSequence().length} |`),
    '',
    '## Consistency comparison',
    '',
    ...summaries.flatMap((summary) => [
      `### ${summary.model.name}`,
      '',
      `Raw average: ${summary.consistency.overall ?? 'N/A'}; raw worst repeated prompt: ${summary.consistency.worst ?? 'N/A'}; final average including fallback: ${summary.finalServerPilot.consistency ?? 'N/A'}.`,
      '',
      '| Prompt | Raw score | Outputs | Critical contradictions |',
      '|---|---:|---:|---:|',
      ...summary.consistency.prompts.map((item) => `| ${item.promptId} | ${item.consistency ?? 'N/A'} | ${item.outputs}/3 | ${item.contradictions} |`),
      '',
    ]),
    '## Error, hallucination, and task completion comparison',
    '',
    '| Model | Severity / flags |',
    '|---|---|',
    ...summaries.map((summary) => `| ${summary.model.name} | Severity: ${Object.entries(summary.severityCounts).map(([key, value]) => `${key}: ${value}`).join(', ') || 'none'}; ${Object.entries(summary.errorCounts).map(([key, value]) => `${key}: ${value}`).join('; ') || 'No detected errors'} |`),
    '',
    '## Latency comparison',
    '',
    '| Model | Average ms | Median ms | Slowest ms |',
    '|---|---:|---:|---:|',
    ...summaries.map((summary) => `| ${summary.model.name} | ${summary.latency.averageMs ?? 'N/A'} | ${summary.latency.medianMs ?? 'N/A'} | ${summary.latency.slowestMs ?? 'N/A'} |`),
    '',
    '## Per-model detailed results',
    '',
    ...summaries.flatMap((summary) => [
      `### ${summary.model.name} — ${summary.model.id}`,
      '',
        `Raw rankable: ${summary.rawQualityRankable ? 'yes' : 'no'}; provider responses ${summary.successfulProviderResponses}/${summary.totalRequests}; valid proposals ${summary.schemaValidProposals}/${summary.totalRequests}; attempted ${summary.attemptedRequests}; skipped ${summary.skippedRequests}; fallbacks ${summary.fallbacks}/${summary.totalRequests}; reconciled ${summary.plansRequiringReconciliation}; clean ${summary.plansAcceptedCleanly}.`,
      '',
      `Raw scores: ${JSON.stringify(summary.rawQuality)}.`,
      '',
    ]),
    '## Raw response samples',
    '',
    ...summaries.flatMap((summary) => {
      const sample = report.attempts.find((attempt) => attempt.model.id === summary.model.id && attempt.rawResponseText);
      return sample ? [
        `### ${summary.model.name} — prompt ${sample.promptId}, repeat ${sample.repeat}`,
        '',
        '```text',
        sample.rawResponseText!.slice(0, 4000).replace(/```/g, '` ` `'),
        '```',
        '',
      ] : [`### ${summary.model.name}`, '', 'No raw response content was returned.', ''];
    }),
    '## Final rankings',
    '',
    ranking(summaries),
    '',
    '## Limitations and recommendation',
    '',
    'The mechanical scores use the fixed prompt feature checklist. Review raw response samples and per-attempt details before drawing product conclusions. Provider errors are not treated as reasoning errors; fallback output is scored only in the production comparison.',
    '',
  ];
  return lines.join('\n');
}

export async function runSmokeTest() {
  const intervals: number[] = [];
  const sent: string[] = [];
  let activeRequests = 0;
  let maximumConcurrency = 0;
  const catalog = models.filter((model) => model.id !== 'nvidia/nemotron-3-ultra:free').map((model) => ({ id: model.id, name: model.name }));
  const hooks: Hooks = {
    catalog: async () => catalog,
    sleep: async (ms) => { intervals.push(ms); },
    send: async (model, scenario, repeat) => {
      activeRequests += 1;
      maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
      sent.push(`${model.id}:${scenario.id}:${repeat}`);
      activeRequests -= 1;
      const plan = createSetupPlan(scenario.type, scenario.prompt);
      const rawContent = JSON.stringify(plan);
      return {
        bodyText: JSON.stringify({ proposal: plan }),
        rawContent,
        rawProposal: plan,
        httpStatus: 200,
        latencyMs: 12,
        request: {
          model: model.id,
          type: scenario.type,
          prompt: scenario.prompt,
          temperature: 0.2,
          responseFormat: { type: 'json_object' },
          systemPrompt: 'Production prompt supplied by the provider adapter.',
          userPayload: JSON.stringify({ model: model.id, prompt: scenario.prompt }),
        },
      };
    },
    reconcile: (model, scenario, proposal, rawText) =>
      productionReconcile(model, scenario, rawText ?? JSON.stringify(proposal)),
  };
  const report = await runBenchmark(hooks);
  const unsupported = report.unavailableModels.some((item) => item.id === 'nvidia/nemotron-3-ultra:free');
  const exactPin = sent.every((entry) => !entry.includes('openrouter/free') && models.some((model) => entry.startsWith(`${model.id}:`)));
  const allPrompts = taskSequence().length === 20 && sent.length === report.modelsTested.length * 20;
  const correctlyReconciled = report.attempts.every((attempt) => attempt.source === 'AI' && attempt.schemaValidation === 'pass');
  const responseCaptureCheck = report.attempts.every((attempt) =>
    typeof attempt.rawResponseText === 'string' && attempt.rawProposal !== undefined);
  const scoreSeparationCheck = report.attempts.every((attempt) =>
    attempt.rawScores !== undefined && attempt.finalScores !== undefined);

  let failureCall = 0;
  const failureHooks: Hooks = {
    catalog: async () => [catalog[0]!],
    sleep: async () => {},
    send: async (model, scenario) => {
      failureCall += 1;
      if (failureCall === 1) throw Object.assign(new Error('Provider rate limit.'), { kind: 'rate_limit', status: 429, latencyMs: 11 });
      if (failureCall === 2) throw Object.assign(new Error('Timed out.'), { kind: 'timeout', latencyMs: 30_000 });
      if (failureCall === 3) return {
        bodyText: '',
        rawContent: '{not-json',
        httpStatus: 200,
        latencyMs: 12,
        request: {
          model: model.id, type: scenario.type, prompt: scenario.prompt, temperature: 0.2,
          responseFormat: { type: 'json_object' }, systemPrompt: 'smoke prompt', userPayload: '{}',
        },
      };
      const invalid = { ...createSetupPlan(scenario.type, scenario.prompt) } as Partial<SetupPlan>;
      delete invalid.categories;
      return {
        bodyText: '',
        rawContent: JSON.stringify(invalid),
        rawProposal: invalid,
        httpStatus: 200,
        latencyMs: 12,
        request: {
          model: model.id, type: scenario.type, prompt: scenario.prompt, temperature: 0.2,
          responseFormat: { type: 'json_object' }, systemPrompt: 'smoke prompt', userPayload: '{}',
        },
      };
    },
    reconcile: (model, scenario, proposal, rawText) =>
      productionReconcile(model, scenario, rawText ?? JSON.stringify(proposal)),
  };
  const failureReport = await runBenchmark(failureHooks);
  const failures = failureReport.attempts.slice(0, 4);
  const failureKindsRecorded = failures.map((attempt) => attempt.failureKind);
  const failureRecordingCheck = failureKindsRecorded[0] === 'rate_limit'
    && failureKindsRecorded[1] === 'timeout'
    && failureKindsRecorded[2] === 'malformed_json'
    && failureKindsRecorded[3] === undefined
    && failures[0]?.httpStatus === 429
    && failures[0]?.severity === 'none'
    && failures[1]?.severity === 'none'
    && failures[2]?.providerResponseReceived === true
    && failures[3]?.schemaValidation === 'fail'
    && failures[3]?.reconciliation === 'fallback';
  let breakerCalls = 0;
  const breakerReport = await runBenchmark({
    catalog: async () => [catalog[0]!],
    sleep: async () => {},
    send: async () => {
      breakerCalls += 1;
      throw Object.assign(new Error('Provider rate limit.'), { kind: 'rate_limit', status: 429, latencyMs: 10 });
    },
    reconcile: productionReconcile,
  });
  const breakerCheck = breakerCalls === 3
    && breakerReport.attempts.filter((attempt) => !attempt.attempted).length === 17
    && breakerReport.summaries[0]?.fallbacks === 20
    && breakerReport.summaries[0]?.finalServerPilot.validFinalPlans === 20;
  const schedulingCheck = intervals.filter((value) => value === requestDelayMs).length === report.modelsTested.length * 19
    && intervals.filter((value) => value === modelDelayMs).length === report.modelsTested.length - 1;
  const passed = unsupported && exactPin && allPrompts && correctlyReconciled
    && maximumConcurrency === 1 && schedulingCheck && responseCaptureCheck
    && scoreSeparationCheck && failureRecordingCheck && breakerCheck;
  if (!passed) {
    throw new Error(`Round 2 smoke test failed: ${JSON.stringify({
      unsupported, exactPin, allPrompts, correctlyReconciled, maximumConcurrency,
      schedulingCheck, responseCaptureCheck, scoreSeparationCheck, failureRecordingCheck, breakerCheck,
      failureKindsRecorded, breakerCalls,
      failureSamples: failures.slice(0, 4).map((attempt) => ({
        error: attempt.failureKind, status: attempt.httpStatus, source: attempt.source,
        providerResponseReceived: attempt.providerResponseReceived, schema: attempt.schemaValidation,
        fallback: attempt.reconciliation, severity: attempt.severity,
      })),
    })}`);
  }
  return {
    passed,
    requestsSentToProvider: 0,
    simulatedRequests: sent.length,
    modelsExercised: report.modelsTested.map((model) => model.id),
    unavailableExactId: report.unavailableModels.find((model) => model.id === 'nvidia/nemotron-3-ultra:free'),
    maximumConcurrentRequests: maximumConcurrency,
    delaysVerified: {
      request: requestDelayMs,
      models: modelDelayMs,
      observedIntervals: intervals,
    },
    recordsRawAndFinalSeparately: scoreSeparationCheck,
    records429AndTimeoutSeparately: failureRecordingCheck,
    recordsMalformedJsonAndValidationFallback: failureRecordingCheck,
    circuitBreakerAfterRepeated429s: breakerCheck,
    preservesRawResponseText: responseCaptureCheck,
    usesProductionReconciliation: correctlyReconciled && failures[3]?.reconciliation === 'fallback',
  };
}

function liveHooks(): Hooks {
  return {
    catalog: liveCatalog,
    send: liveSend,
    reconcile: (model, scenario, proposal, rawText) =>
      productionReconcile(model, scenario, rawText ?? JSON.stringify(proposal)),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onAttempt: (attempt) => {
      console.log(JSON.stringify({
        model: attempt.model.id,
        prompt: attempt.promptId,
        repeat: attempt.repeat,
        source: attempt.source,
        status: attempt.httpStatus,
        error: attempt.failureKind,
        latencyMs: attempt.latencyMs,
        severity: attempt.severity,
        finalChannels: flattenPlan(attempt.finalPlan).channels,
      }));
    },
  };
}

async function main() {
  const mode = process.argv[2];
  if (mode === '--smoke') {
    console.log(JSON.stringify(await runSmokeTest(), null, 2));
    return;
  }
  if (mode !== '--run') {
    throw new Error('Usage: node --import tsx test/benchmark-round2.ts --smoke | --run [results.json]');
  }
  const destination = process.argv[3] ?? 'ai-model-benchmark-round2-results.json';
  if (!/\.json$/i.test(destination)) {
    throw new Error('The results destination must end in .json so the Markdown report can be written beside it.');
  }
  const catalog = await liveCatalog();
  const resolution = resolveCatalogModels(catalog);
  if (!resolution.available.length) {
    throw new Error('No exact pinned models are available; no benchmark request was sent.');
  }
  console.log(JSON.stringify({
    pinnedModelsAvailable: resolution.available.map(({ id }) => id),
    unavailableModels: resolution.unavailable,
    requestsPerModel: taskSequence().length,
    plannedRequests: taskSequence().length * resolution.available.length,
    requestDelayMs,
    modelDelayMs,
    confirmationRequiredForFullRun: false,
  }, null, 2));
  const report = await runBenchmark(liveHooks(), destination);
  console.log(JSON.stringify({
    results: destination,
    markdownReport: markdownDestinationFor(destination),
    summaries: report.summaries.map((summary) => ({
      model: summary.model.id,
      responses: summary.successfulProviderResponses,
      valid: summary.schemaValidProposals,
      fallback: summary.fallbacks,
      rankable: summary.rawQualityRankable,
    })),
  }, null, 2));
}

const currentFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === currentFile) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown benchmark error.';
    console.error(message);
    process.exitCode = 1;
  });
}
