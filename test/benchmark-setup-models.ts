import 'dotenv/config';
import { readFile, writeFile } from 'node:fs/promises';
import { OpenAiCompatibleProvider } from '../src/ai/provider.js';
import { generateSetupPlan } from '../src/ai/planner.js';
import { createSetupPlan, extractSetupIntent } from '../src/setup/planner.js';
import type { SetupPlan, SetupType } from '../src/setup/types.js';

type Model = { id: string; name: string };
type PromptCase = {
  id: number;
  type: SetupType;
  prompt: string;
  required: string[];
  forbidden: string[];
  minimal?: boolean;
  noUnmentionedGames?: boolean;
  voiceAtLeast?: number;
  voiceExactly?: number;
};
type SafePlan = {
  channels: string[];
  voiceChannels: string[];
  roles: string[];
  categories: string[];
  rules: string[];
  extraFields: string[];
};
type Attempt = {
  model: string;
  promptId: number;
  repeat: number;
  source: 'AI' | 'FALLBACK';
  success: boolean;
  errorKind?: string;
  status?: number;
  latencyMs: number;
  jsonValid: boolean;
  raw?: SafePlan;
  final: SafePlan;
};

const candidateModels: Model[] = [
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 4 26B A4B free' },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 4 31B free' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Nemotron 3 Ultra free' },
  { id: 'nvidia/nemotron-3.5-lightning:free', name: 'Nemotron 3.5 Lightning free' },
  { id: 'dots-studio/dots-3-note-preview:free', name: 'Dots3-Note Preview free' },
];

const promptCases: PromptCase[] = [
  { id: 1, type: 'Gaming', prompt: "tiny Minecraft server for 8 friends. just general, minecraft chat and one voice channel. don't add anything else.", required: ['general', 'minecraft-chat'], forbidden: ['tickets', 'support', 'announcements', 'applications', 'tournaments', 'player-recruitment', 'vip'], minimal: true, voiceExactly: 1, noUnmentionedGames: true },
  { id: 2, type: 'Gaming', prompt: '20 mates, chill Minecraft server, we play together and sometimes do events. keep it simple.', required: ['general', 'minecraft-chat', 'events'], forbidden: ['tickets', 'support', 'tournaments', 'player-recruitment', 'vip'], minimal: true, voiceAtLeast: 0, noUnmentionedGames: true },
  { id: 3, type: 'Gaming', prompt: 'private server for me and 12 friends. no tickets, no staff team, nothing complicated.', required: ['general'], forbidden: ['tickets', 'support', 'staff-applications', 'tournaments', 'vip'], minimal: true },
  { id: 4, type: 'Community', prompt: 'just a general chat and voice channel for a small friend group.', required: ['general'], forbidden: ['tickets', 'support', 'applications', 'tournaments', 'vip'], minimal: true, voiceExactly: 1 },
  { id: 5, type: 'Gaming', prompt: 'professional public Minecraft Discord for around 2000 members. weekly tournaments, staff team, applications, support tickets, announcements, several voice channels, media section and team areas.', required: ['general', 'minecraft-chat', 'tournaments', 'staff-applications', 'tickets', 'announcements', 'media', 'teams'], forbidden: ['vip', 'player-recruitment', 'support'], voiceAtLeast: 2, noUnmentionedGames: true },
  { id: 6, type: 'Gaming', prompt: 'large competitive gaming community with moderators, applications, support, tournaments, announcements and separate areas for different games.', required: ['moderator', 'applications', 'support', 'tournaments', 'announcements'], forbidden: ['vip', 'player-recruitment'] },
  { id: 7, type: 'Creator', prompt: 'public creator community with thousands of members. creators need somewhere to share content, receive feedback, collaborate, and contact staff.', required: ['media', 'feedback', 'collaboration', 'staff-contact'], forbidden: ['vip', 'tickets', 'tournaments', 'player-recruitment'] },
  { id: 8, type: 'Gaming', prompt: 'Minecraft server for 50 people. We need general, Minecraft chat and voice. no tickets, no support, no announcements, no staff applications.', required: ['general', 'minecraft-chat'], forbidden: ['tickets', 'support', 'announcements', 'staff-applications', 'vip'], minimal: true, voiceAtLeast: 1, noUnmentionedGames: true },
  { id: 9, type: 'Gaming', prompt: "gaming community, but don't create channels for games I haven't mentioned.", required: ['general'], forbidden: ['fortnite-chat', 'minecraft-chat', 'valorant-chat', 'league-of-legends-chat', 'apex-legends-chat', 'rocket-league-chat', 'overwatch-chat', 'tournaments', 'vip'], minimal: true, noUnmentionedGames: true },
  { id: 10, type: 'Gaming', prompt: "make a server for 30 friends. we sometimes host game nights. don't turn it into a tournament server.", required: ['general', 'events'], forbidden: ['tournaments', 'staff-applications', 'tickets', 'vip'], minimal: true },
  { id: 11, type: 'Gaming', prompt: 'Minecraft server where people can post their builds. We also need one general chat and two voice channels.', required: ['general', 'minecraft-chat', 'build-showcase'], forbidden: ['clips', 'tickets', 'tournaments', 'vip'], voiceExactly: 2, noUnmentionedGames: true },
  { id: 12, type: 'Gaming', prompt: 'competitive Minecraft server. We recruit players for teams and need player applications.', required: ['minecraft-chat', 'teams', 'player-recruitment'], forbidden: ['vip'], noUnmentionedGames: true },
  { id: 13, type: 'Community', prompt: 'community where members can apply to become staff. We also need support tickets.', required: ['staff-applications', 'tickets'], forbidden: ['vip', 'player-recruitment'] },
  { id: 14, type: 'Community', prompt: 'Discord for a football community. match discussion, fixtures, player discussion, announcements and voice.', required: ['match-discussion', 'fixtures', 'player-discussion', 'announcements'], forbidden: ['minecraft-chat', 'fortnite-chat', 'tournaments', 'vip'], voiceAtLeast: 1 },
  { id: 15, type: 'Gaming', prompt: "yo can u make me a minecraft discord for like 20 ppl nothing crazy tho just somewhere to chat play and show builds maybe a vc, we dont need tickets", required: ['general', 'minecraft-chat', 'build-showcase'], forbidden: ['tickets', 'support', 'tournaments', 'vip'], minimal: true, noUnmentionedGames: true },
  { id: 16, type: 'Gaming', prompt: 'need a proper server for around 500 ppl, kinda serious, tournaments every week, staff apps, tickets, announcements, teams and a few vcs', required: ['tournaments', 'staff-applications', 'tickets', 'announcements', 'teams'], forbidden: ['vip'], voiceAtLeast: 2 },
  { id: 17, type: 'Gaming', prompt: 'me n some mates wanna start a chill gaming discord. probably minecraft mainly but sometimes other stuff. dont make 50 channels lol', required: ['general', 'minecraft-chat'], forbidden: ['tickets', 'support', 'tournaments', 'vip'], minimal: true },
  { id: 18, type: 'Gaming', prompt: 'make me a good Minecraft server', required: ['general', 'minecraft-chat'], forbidden: ['tournaments', 'tickets', 'support', 'vip'], noUnmentionedGames: true },
  { id: 19, type: 'Community', prompt: 'we have events', required: ['events'], forbidden: ['tournaments', 'vip'] },
  { id: 20, type: 'Community', prompt: 'we need teams', required: ['teams'], forbidden: ['player-recruitment', 'applications', 'vip'] },
];

const repetitions = new Set([1, 2, 5, 8, 15]);

function safePlan(value: unknown): SafePlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { channels: [], voiceChannels: [], roles: [], categories: [], rules: [], extraFields: [] };
  }
  const plan = value as Record<string, unknown>;
  const stringList = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string').map((item) => item.slice(0, 100)) : [];
  const categories = Array.isArray(plan.categories) ? plan.categories.filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)) as Array<Record<string, unknown>> : [];
  const voiceCategories = Array.isArray(plan.voiceCategories) ? plan.voiceCategories.filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)) as Array<Record<string, unknown>> : [];
  const roles = Array.isArray(plan.roles) ? plan.roles.filter((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)) as Array<Record<string, unknown>> : [];
  return {
    channels: categories.flatMap((category) => stringList(category.channels)),
    voiceChannels: voiceCategories.flatMap((category) => stringList(category.channels)),
    roles: roles.map((role) => typeof role.name === 'string' ? role.name.slice(0, 100) : ''),
    categories: categories.map((category) => typeof category.name === 'string' ? category.name.slice(0, 100) : ''),
    rules: stringList(plan.rules).map((rule) => rule.slice(0, 160)),
    extraFields: Object.keys(plan).filter((key) => ![
      'type', 'description', 'categories', 'voiceCategories', 'recommendedFeatures',
      'requestedFeatures', 'skippedFeatures', 'roles', 'rules',
    ].includes(key)),
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function hasFeature(plan: SafePlan, feature: string) {
  const values = [...plan.channels, ...plan.roles].map(normalize);
  const matchers: Record<string, RegExp> = {
    'minecraft-chat': /minecraft(?:-chat)?/,
    media: /media|content|video|clips/,
    collaboration: /collab|partner|creator/,
    'staff-contact': /staff|support|contact/,
    'match-discussion': /match|football-chat|discussion/,
    fixtures: /fixture|schedule/,
    'player-discussion': /player|football/,
  };
  const matcher = matchers[feature];
  return values.some((value) => matcher ? matcher.test(value) : value.includes(normalize(feature)));
}

function unwantedFeatures(plan: SafePlan, prompt: PromptCase) {
  const all = [...plan.channels, ...plan.roles].map(normalize);
  const bad = prompt.forbidden.filter((feature) => {
    if (feature === 'voice') return plan.voiceChannels.length > 0;
    return all.some((value) => value.includes(normalize(feature)));
  });
  if (prompt.noUnmentionedGames) {
    const mentionedGames = ['minecraft', 'fortnite', 'valorant', 'league-of-legends', 'apex-legends', 'rocket-league', 'overwatch']
      .filter((game) => prompt.prompt.toLowerCase().includes(game));
    for (const game of ['fortnite', 'minecraft', 'valorant', 'league-of-legends', 'apex-legends', 'rocket-league', 'overwatch']) {
      if (!mentionedGames.includes(game) && plan.channels.some((channel) => normalize(channel).includes(game))) bad.push(`${game}-chat`);
    }
  }
  if (!/\b(?:vip|supporter|premium|donor|booster|paid|sponsor)\b/i.test(prompt.prompt)) {
    if (plan.roles.some((role) => /\b(?:vip|supporter|premium|donor|booster|paid|sponsor)\b/i.test(role))) bad.push('monetisation-role');
    if (plan.channels.some((channel) => /\b(?:vip|supporter|premium|donor|booster|paid|sponsor)\b/i.test(channel))) bad.push('monetisation-channel');
  }
  if (!prompt.forbidden.includes('player-recruitment') && !/recruit|tryout|player applications|apply to join teams/i.test(prompt.prompt)
    && plan.channels.some((channel) => /player.?recruit|tryout/i.test(channel))) bad.push('player-recruitment');
  return [...new Set(bad)];
}

function scorePlan(plan: SafePlan, prompt: PromptCase) {
  const requiredHits = prompt.required.filter((feature) => hasFeature(plan, feature)).length;
  const requiredCoverage = prompt.required.length ? requiredHits / prompt.required.length : 1;
  const violations = unwantedFeatures(plan, prompt);
  const forbiddenRatio = prompt.forbidden.length ? violations.length / prompt.forbidden.length : 0;
  const extras = plan.channels.filter((channel) => {
    const normalized = normalize(channel);
    return !prompt.required.some((required) => normalized.includes(normalize(required)) || normalize(required).includes(normalized));
  }).length;
  const extraRoles = plan.roles.filter((role) => !/owner|member/i.test(role)
    && !prompt.required.some((required) => normalize(role).includes(normalize(required)))).length;
  const scalePenalty = prompt.minimal
    ? Math.max(0, plan.channels.length + plan.voiceChannels.length - (prompt.voiceExactly ?? 4))
    : Math.max(0, plan.channels.length + plan.voiceChannels.length - 16);
  const voiceOkay = (prompt.voiceAtLeast === undefined || plan.voiceChannels.length >= prompt.voiceAtLeast)
    && (prompt.voiceExactly === undefined || plan.voiceChannels.length === prompt.voiceExactly);
  const intent = Math.max(0, 10 * (0.7 * requiredCoverage + 0.3 * (voiceOkay ? 1 : 0)));
  const following = Math.max(0, 10 * (0.8 * requiredCoverage + 0.2 * (violations.length === 0 ? 1 : 0)));
  const exclusions = Math.max(0, 10 * (1 - forbiddenRatio));
  const hallucinations = Math.max(0, 10 - Math.min(10, violations.length * 3 + Math.max(0, extras - 2) + Math.max(0, extraRoles - 1) * 2));
  const proportionality = Math.max(0, 10 - Math.min(10, scalePenalty + Math.max(0, plan.categories.length - (prompt.minimal ? 4 : 10)) + Math.max(0, extraRoles - 1)));
  const completion = Math.max(0, 10 * requiredCoverage * (voiceOkay ? 1 : 0.8));
  return {
    intent,
    following,
    exclusions,
    hallucinations,
    proportionality,
    completion,
    requiredCoverage,
    violations,
    extras,
    extraRoles,
    missing: prompt.required.filter((feature) => !hasFeature(plan, feature)),
  };
}

function jaccard(left: SafePlan, right: SafePlan) {
  const a = new Set([...left.channels, ...left.voiceChannels.map((voice) => `voice:${voice}`), ...left.roles.map((role) => `role:${role}`)].map(normalize));
  const b = new Set([...right.channels, ...right.voiceChannels.map((voice) => `voice:${voice}`), ...right.roles.map((role) => `role:${role}`)].map(normalize));
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  return [...a].filter((item) => b.has(item)).length / union.size;
}

function classifyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const status = Number(message.match(/\bstatus (\d{3})\b/i)?.[1]);
  const name = error instanceof Error ? error.name : '';
  const kind = status === 429 ? 'rate_limit'
    : status >= 500 ? 'provider_unavailable'
      : status > 0 ? 'http_error'
        : /timeout|abort/i.test(name) ? 'timeout'
          : /JSON|position|property|unexpected token/i.test(message) ? 'malformed_json'
            : 'request_or_provider_error';
  return { errorKind: kind, ...(status > 0 ? { status } : {}) };
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function reconcileWithProduction(model: string, prompt: PromptCase, raw: unknown) {
  const originalFetch = globalThis.fetch;
  const originalModel = process.env.AI_MODEL;
  const originalWarn = console.warn;
  let invalidByProduction = false;
  process.env.AI_MODEL = model;
  console.warn = () => { invalidByProduction = true; };
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(raw) } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const plan = await generateSetupPlan(prompt.type, prompt.prompt);
    return { plan, fallback: invalidByProduction };
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalModel === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = originalModel;
  }
}

const emptyPlan: SafePlan = { channels: [], voiceChannels: [], roles: [], categories: [], rules: [], extraFields: [] };

function aggregate(attempts: Attempt[], scoreRaw = false) {
  const scored = attempts.filter((attempt) => !scoreRaw || attempt.raw !== undefined).map((attempt) => {
    const prompt = promptCases.find((entry) => entry.id === attempt.promptId)!;
    const plan = scoreRaw ? attempt.raw ?? emptyPlan : attempt.final;
    return { attempt, plan, score: scorePlan(plan, prompt) };
  });
  const byPrompt = new Map<number, Attempt[]>();
  for (const attempt of attempts.filter((item) => !scoreRaw || item.raw !== undefined)) {
    const list = byPrompt.get(attempt.promptId) ?? [];
    list.push(attempt);
    byPrompt.set(attempt.promptId, list);
  }
  const repeatedComparisons = [...byPrompt.values()].filter((items) => items.length > 1).flatMap((items) => {
    const plans = items.map((item) => scoreRaw ? item.raw! : item.final);
    return plans.flatMap((plan, index) => plans.slice(index + 1).map((other) => jaccard(plan, other)));
  });
  const consistency = repeatedComparisons.length
    ? repeatedComparisons.reduce((sum, value) => sum + value, 0) / repeatedComparisons.length
    : scoreRaw ? null : 1;
  const jsonValid = scoreRaw
    ? attempts.filter((attempt) => attempt.jsonValid).length / Math.max(1, attempts.length) * 10
    : 10;
  const availability = attempts.filter((attempt) => attempt.success).length / Math.max(1, attempts.length) * 10;
  const avg = (key: 'intent' | 'following' | 'exclusions' | 'hallucinations' | 'proportionality' | 'completion') =>
    scored.length ? scored.reduce((sum, item) => sum + item.score[key], 0) / scored.length : null;
  const metrics = {
    intent: avg('intent'),
    following: avg('following'),
    exclusions: avg('exclusions'),
    hallucinations: avg('hallucinations'),
    proportionality: avg('proportionality'),
    completion: avg('completion'),
    relevance: scored.length ? scored.reduce((sum, item) => sum + Math.max(0, 10 - item.score.extras - item.score.extraRoles), 0) / scored.length : null,
    naturalLanguage: avg('intent'),
    consistency: consistency === null ? null : consistency * 10,
    json: jsonValid,
    availability: availability,
    overallTask: scored.length ? scored.reduce((sum, item) => sum + item.score.completion, 0) / scored.length : null,
  };
  const overall = Object.values(metrics).some((value) => value === null)
    ? null
    : metrics.intent! * 2 + metrics.following! * 1.5 + metrics.exclusions! * 1.5 + metrics.hallucinations!
      + metrics.proportionality! + metrics.completion! + metrics.consistency! + metrics.json * 0.5 + metrics.availability * 0.5;
  const extraSignature = (attempt: Attempt) => {
    const prompt = promptCases.find((entry) => entry.id === attempt.promptId)!;
    const plan = scoreRaw ? attempt.raw! : attempt.final;
    const required = prompt.required.map(normalize);
    return JSON.stringify({
      channels: plan.channels.filter((channel) => !required.some((feature) => normalize(channel).includes(feature) || feature.includes(normalize(channel)))),
      roles: plan.roles.filter((role) => !/owner|member/i.test(role) && !required.some((feature) => normalize(role).includes(feature))),
    });
  };
  return {
    ...metrics,
    overall,
    successfulRequests: attempts.filter((attempt) => attempt.success).length,
    failedRequests: attempts.filter((attempt) => !attempt.success).length,
    averageLatencyMs: Math.round(attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0) / Math.max(1, attempts.length)),
    slowestLatencyMs: Math.max(0, ...attempts.map((attempt) => attempt.latencyMs)),
    averageRepeatedConsistency: consistency === null ? null : consistency * 10,
    worstRepeatedConsistency: repeatedComparisons.length ? Math.min(...repeatedComparisons) * 10 : scoreRaw ? null : 10,
    majorContradictions: scored.filter(({ score }) => score.violations.length > 0).length,
    repeatedOutputsWithDifferentExtras: [...byPrompt.values()].filter((items) => items.length > 1)
      .filter((items) => new Set(items.map(extraSignature)).size > 1).length,
  };
}

async function main() {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error('AI_API_KEY is not configured; benchmark requests were not started.');
  }
  const destination = process.argv[2];
  if (!destination) {
    throw new Error('Pass a destination path for the sanitized benchmark JSON artifact.');
  }
  const baseUrl = process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const catalogResponse = await fetch(`${baseUrl.replace(/\/$/, '')}/models`);
  if (!catalogResponse.ok) {
    throw new Error(`Could not inspect provider model availability (HTTP ${catalogResponse.status}).`);
  }
  const catalog = await catalogResponse.json() as { data?: Array<{ id?: string; name?: string }> };
  const listedIds = new Set((catalog.data ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)));
  const availableModels = candidateModels.filter((model) => listedIds.has(model.id));
  const unavailableModels = candidateModels.filter((model) => !listedIds.has(model.id));
  const attempts: Attempt[] = [];
  const tasks = [
    ...promptCases.map((prompt) => ({ prompt, repeat: 1 })),
    ...promptCases.filter((prompt) => repetitions.has(prompt.id)).flatMap((prompt) => [
      { prompt, repeat: 2 },
      { prompt, repeat: 3 },
    ]),
  ];

  for (const task of tasks) {
    const rawBatch = await Promise.all(availableModels.map(async (model) => {
      const start = Date.now();
      const provider = new OpenAiCompatibleProvider(apiKey, model.id, baseUrl);
      try {
        const fallbackPlan: SetupPlan = createSetupPlan(task.prompt.type, task.prompt.prompt);
        const raw = await provider.generatePlan({
          type: task.prompt.type,
          description: task.prompt.prompt,
          intent: extractSetupIntent(task.prompt.type, task.prompt.prompt),
          fallbackPlan,
        });
        return {
          model: model.id,
          promptId: task.prompt.id,
          repeat: task.repeat,
          success: true as const,
          latencyMs: Date.now() - start,
          raw,
        };
      } catch (error) {
        const failure = classifyFailure(error);
        return {
          model: model.id,
          promptId: task.prompt.id,
          repeat: task.repeat,
          success: false as const,
          ...failure,
          latencyMs: Date.now() - start,
        };
      }
    }));
    const batch: Attempt[] = [];
    for (const item of rawBatch) {
      if (!item.success) {
        batch.push({
          model: item.model,
          promptId: item.promptId,
          repeat: item.repeat,
          source: 'FALLBACK',
          success: false,
          errorKind: item.errorKind,
          status: item.status,
          latencyMs: item.latencyMs,
          jsonValid: false,
          final: safePlan(createSetupPlan(task.prompt.type, task.prompt.prompt)),
        });
        continue;
      }
      const reconciled = await reconcileWithProduction(item.model, task.prompt, item.raw);
      batch.push({
        model: item.model,
        promptId: item.promptId,
        repeat: item.repeat,
        source: reconciled.fallback ? 'FALLBACK' : 'AI',
        success: true,
        latencyMs: item.latencyMs,
        jsonValid: !reconciled.fallback,
        raw: safePlan(item.raw),
        final: safePlan(reconciled.plan),
      });
    }
    attempts.push(...batch);
    for (const current of batch) {
      console.log(JSON.stringify({
        model: current.model,
        prompt: current.promptId,
        repeat: current.repeat,
        source: current.source,
        success: current.success,
        ...(current.errorKind ? { error: current.errorKind, ...(current.status ? { status: current.status } : {}) } : {}),
        latencyMs: current.latencyMs,
        channels: current.raw?.channels ?? current.final.channels,
        voiceChannels: current.raw?.voiceChannels ?? current.final.voiceChannels,
        roles: current.raw?.roles ?? current.final.roles,
      }));
    }
    await writeFile(destination, JSON.stringify({ partial: true, attempts }, null, 2), { mode: 0o600 });
    await delay(1200);
  }

  const summaries = Object.fromEntries(availableModels.map((model) => {
    const modelAttempts = attempts.filter((attempt) => attempt.model === model.id);
    return [model.id, {
      raw: aggregate(modelAttempts, true),
      final: aggregate(modelAttempts),
      errors: modelAttempts.filter((attempt) => !attempt.success || !attempt.jsonValid)
        .map(({ promptId, repeat, source, errorKind, status }) => ({ promptId, repeat, source, errorKind, status })),
    }];
  }));
  const report = {
    generatedAt: new Date().toISOString(),
    settings: { temperature: 0.2, responseFormat: 'json_object', repeatsPerSelectedPrompt: 3 },
    models: availableModels,
    unavailableModels,
    prompts: promptCases,
    attempts,
    summaries,
  };
  await writeFile(destination, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({
    completedAttempts: attempts.length,
    expectedAttempts: tasks.length * availableModels.length,
    unavailableModels,
    summaries,
    artifactWritten: true,
  }, null, 2));
}

async function rescoreExisting(destination: string) {
  const report = JSON.parse(await readFile(destination, 'utf8')) as {
    models: Model[];
    attempts: Attempt[];
    summaries?: Record<string, unknown>;
    partial?: boolean;
  };
  report.summaries = Object.fromEntries(report.models.map((model) => {
    const modelAttempts = report.attempts.filter((attempt) => attempt.model === model.id);
    return [model.id, {
      raw: aggregate(modelAttempts, true),
      final: aggregate(modelAttempts),
      errors: modelAttempts.filter((attempt) => !attempt.success || !attempt.jsonValid)
        .map(({ promptId, repeat, source, errorKind, status }) => ({ promptId, repeat, source, errorKind, status })),
    }];
  }));
  report.partial = false;
  await writeFile(destination, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ attempts: report.attempts.length, rescored: true }, null, 2));
}

const rescorePath = process.argv[2] === '--rescore-existing' ? process.argv[3] : undefined;
(rescorePath ? rescoreExisting(rescorePath) : main()).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown benchmark harness error.';
  console.error(message);
  process.exitCode = 1;
});
