import assert from 'node:assert/strict';
import test from 'node:test';
import { Collection, ChannelType } from 'discord.js';
import {
  applyExplicitSetupIntent,
  applySetupAnswer,
  createSetupPlan,
  extractSetupIntent,
} from '../src/setup/planner.js';
import { generateSetupPlan } from '../src/ai/planner.js';
import { createSetupStructure } from '../src/setup/creator.js';
import type { SetupType } from '../src/setup/types.js';

const cases: Array<[SetupType, string]> = [
  ['Gaming', "yo i need a minecraft server for like 20 mates, pretty chill, we do events sometimes but dont make it some massive corporate discord, probably need voice and somewhere to show builds, no tickets tho"],
  ['Gaming', "just make me a tiny minecraft server for 8 friends. we mainly talk and play together. i only want general, minecraft chat and one voice channel. don't add anything else."],
  ['Gaming', 'make a minecraft discord for 2000 people. public server. we run weekly tournaments, have staff, need applications, tickets, announcements and several voice channels.'],
  ['Gaming', 'small chill server for me and 12 friends. Minecraft only. no tickets, no announcements, no complicated roles.'],
  ['Gaming', 'we play Minecraft and Fortnite with about 50 people. want separate chats for both, general, clips and voice.'],
  ['Gaming', "we're a competitive minecraft community with weekly tournaments and around 500 members. need team areas, tournament info, applications and staff."],
  ['Gaming', 'make a very simple server. just general chat and voice. nothing else.'],
  ['Community', "we occasionally host events but they're just community game nights."],
  ['Gaming', 'we need somewhere people can post their Minecraft builds.'],
  ['Gaming', 'make me a gaming server.'],
  ['Creator', 'professional Minecraft community for creators, 1000 members, announcements, content sharing, applications and support.'],
  ['Gaming', 'small private server for 15 mates. keep it really basic. no bots, no tickets, no staff team.'],
];

function channels(index: number) {
  return cases[index] ? createSetupPlan(...cases[index]).categories.flatMap((category) => category.channels) : [];
}

test('all twelve requested prompts produce proportional structures and obey explicit intent', () => {
  const plans = cases.map(([type, description]) => createSetupPlan(type, description));
  const voice = (index: number) => plans[index]?.voiceCategories.flatMap((category) => category.channels) ?? [];

  assert.ok(['minecraft-chat', 'build-showcase', 'general', 'events'].every((channel) => channels(0).includes(channel)));
  assert.deepEqual(voice(0), ['General']);
  assert.ok(!channels(0).some((channel) => /support|ticket|fortnite|looking-for-group|clips|tournaments/.test(channel)));
  assert.deepEqual(channels(1).sort(), ['general', 'minecraft-chat']);
  assert.deepEqual(voice(1), ['General']);
  assert.equal(channels(1).length + voice(1).length, 3);
  assert.equal(extractSetupIntent(...cases[2]!).scale, 'very-large');
  assert.ok(['tournaments', 'tickets', 'announcements', 'staff-applications'].every((channel) => channels(2).includes(channel)));
  assert.deepEqual(voice(2), ['General', 'Gaming', 'Events']);
  assert.ok(plans[2]?.roles.some((role) => role.kind === 'staff'));
  assert.ok(!channels(3).some((channel) => /ticket|support|announcement|fortnite/.test(channel)));
  assert.equal(plans[3]?.roles.filter((role) => role.kind === 'staff' || role.kind === 'vip').length, 0);
  assert.ok(['minecraft-chat', 'fortnite-chat', 'general', 'clips'].every((channel) => channels(4).includes(channel)));
  assert.deepEqual(voice(4), ['General']);
  assert.ok(['tournaments', 'teams', 'staff-applications'].every((channel) => channels(5).includes(channel)));
  assert.ok(!channels(5).includes('player-recruitment'));
  assert.ok(plans[5]?.roles.some((role) => role.kind === 'staff'));
  assert.deepEqual(channels(6), ['general']);
  assert.deepEqual(voice(6), ['General']);
  assert.deepEqual(channels(7), ['general', 'events']);
  assert.ok(!channels(7).includes('tournaments'));
  assert.ok(channels(8).includes('build-showcase'));
  assert.ok(!channels(8).some((channel) => ['clips', 'content-discussion', 'feedback', 'video-sharing'].includes(channel)));
  assert.ok(channels(9).includes('gaming-chat'));
  assert.ok(channels(9).length >= 4);
  assert.ok(['announcements', 'content-discussion', 'support', 'staff-applications'].every((channel) => channels(10).includes(channel)));
  assert.ok(!channels(11).some((channel) => /ticket|support|staff|application/.test(channel)));
  assert.equal(plans[11]?.roles.filter((role) => role.kind === 'staff' || role.kind === 'vip').length, 0);
});

test('large professional communities get only requested commercial and recruitment structure', () => {
  const professional = createSetupPlan(
    'Gaming',
    'Professional Minecraft community with 2000 members, weekly tournaments, staff, applications, support tickets, announcements, several voice channels, a media section and team areas.',
  );
  const professionalChannels = professional.categories.flatMap((category) => category.channels);
  const professionalVoices = professional.voiceCategories.flatMap((category) => category.channels);
  assert.ok(!professional.roles.some((role) => role.kind === 'vip'));
  assert.ok(professionalChannels.includes('teams'));
  assert.ok(professionalChannels.includes('staff-applications'));
  assert.ok(professionalChannels.includes('tickets'));
  assert.ok(!professionalChannels.includes('support'));
  assert.ok(professionalChannels.includes('tournaments'));
  assert.ok(professionalChannels.includes('announcements'));
  assert.ok(['content-discussion', 'feedback', 'video-sharing'].every((channel) => professionalChannels.includes(channel)));
  assert.equal(professionalVoices.length, 3);
  assert.ok(!professionalChannels.includes('player-recruitment'));

  const reconciled = applyExplicitSetupIntent({
    ...professional,
    categories: [...professional.categories, {
      name: 'AI-inferred features',
      channels: ['support', 'player-recruitment', 'team-recruitment'],
    }],
    roles: [...professional.roles, {
      ...professional.roles[1]!,
      name: '⭐ VIP',
      kind: 'vip',
    }],
  }, extractSetupIntent('Gaming', professional.description), professional);
  assert.ok(!reconciled.categories.flatMap((category) => category.channels).some((channel) =>
    ['support', 'player-recruitment', 'team-recruitment'].includes(channel)));
  assert.ok(!reconciled.roles.some((role) => role.kind === 'vip' || /\bvip\b/i.test(role.name)));
});

test('VIP roles require a stated tier or explicit user confirmation', () => {
  const supporterPlan = createSetupPlan('Community', 'Large gaming community with VIP members and paid supporters.');
  assert.ok(supporterPlan.roles.some((role) => role.kind === 'vip'));

  const decidePlan = createSetupPlan('Community', 'Large gaming community.', { 'roles-vip': 'decide' });
  assert.ok(!decidePlan.roles.some((role) => role.kind === 'vip'));
  const confirmedPlan = createSetupPlan('Community', 'Large gaming community.', { 'roles-vip': 'yes' });
  assert.ok(confirmedPlan.roles.some((role) => role.kind === 'vip'));
});

test('team areas do not imply recruitment, but explicit recruitment requests are included', () => {
  const teamsPlan = createSetupPlan('Gaming', 'Competitive server with teams.');
  const teamsChannels = teamsPlan.categories.flatMap((category) => category.channels);
  assert.ok(teamsChannels.includes('teams'));
  assert.ok(!teamsChannels.includes('player-recruitment'));

  const recruitmentPlan = createSetupPlan('Community', 'Public community where members can apply to join teams.');
  const recruitmentChannels = recruitmentPlan.categories.flatMap((category) => category.channels);
  assert.ok(recruitmentChannels.includes('teams'));
  assert.ok(recruitmentChannels.includes('player-recruitment'));

  const playerRecruitmentPlan = createSetupPlan('Gaming', 'Competitive server with teams and player recruitment.');
  assert.ok(playerRecruitmentPlan.categories.flatMap((category) => category.channels).includes('player-recruitment'));
});

test('small casual communities do not gain inferred support or competition features', () => {
  const smallPlan = createSetupPlan('Gaming', 'Small Minecraft server for 20 friends, chill, no tickets.');
  const smallChannels = smallPlan.categories.flatMap((category) => category.channels);
  assert.ok(!smallPlan.roles.some((role) => role.kind === 'vip'));
  assert.ok(!smallChannels.some((channel) => /support|ticket|recruit|tournament/i.test(channel)));
});

test('support tickets stay distinct from a separately requested support channel', () => {
  const ticketsOnly = createSetupPlan('Community', 'Large community with support tickets.');
  const ticketChannels = ticketsOnly.categories.flatMap((category) => category.channels);
  assert.ok(ticketChannels.includes('tickets'));
  assert.ok(!ticketChannels.includes('support'));

  const ticketsAndSupport = createSetupPlan('Community', 'Large community with support tickets and a separate support information channel.');
  const separateChannels = ticketsAndSupport.categories.flatMap((category) => category.channels);
  assert.ok(separateChannels.includes('tickets'));
  assert.ok(separateChannels.includes('support'));
});

test('natural-language exclusions are token-bounded and do not suppress positive requests in other clauses', () => {
  const noTickets = extractSetupIntent('Gaming', "We don't need tickets, but we do need support.");
  assert.ok(noTickets.excludedFeatures.includes('tickets'));
  assert.ok(noTickets.requestedFeatures.includes('support'));
  assert.ok(!extractSetupIntent('Gaming', 'A chill community with announcements.').excludedFeatures.includes('announcements'));
  assert.ok(extractSetupIntent('Gaming', "Don't add announcements; no tickets or support, leave out voice, and we don't use applications.").excludedFeatures.includes('announcements'));
  const plan = createSetupPlan('Gaming', "Don't add announcements; no tickets or support, leave out voice, and we don't use applications.");
  assert.ok(!plan.categories.flatMap((category) => category.channels).some((channel) => /announcement|ticket|support|application/.test(channel)));
  assert.equal(plan.voiceCategories.length, 0);
});

test('AI reconciliation removes template leakage while preserving custom relevant channels', () => {
  const [type, description] = cases[0]!;
  const intent = extractSetupIntent(type, description);
  const fallback = createSetupPlan(type, description);
  const conflictingAiPlan = {
    ...fallback,
    categories: [...fallback.categories, { name: 'AI defaults', channels: ['support', 'tickets', 'fortnite-chat', 'looking-for-group', 'clips', 'tournaments', 'custom-lounge'] }],
  };
  const reconciled = applyExplicitSetupIntent(conflictingAiPlan, intent, fallback);
  const resultChannels = reconciled.categories.flatMap((category) => category.channels);
  assert.ok(['build-showcase', 'custom-lounge'].every((channel) => resultChannels.includes(channel)));
  assert.ok(!resultChannels.some((channel) => /support|ticket|fortnite|looking-for-group|clips|tournaments/.test(channel)));
});

test('only-listed channels suppress defaults and setup answers retain unrelated AI planning', () => {
  const [type, description] = cases[1]!;
  const fallback = createSetupPlan(type, description);
  assert.deepEqual(fallback.categories.flatMap((category) => category.channels).sort(), ['general', 'minecraft-chat']);
  assert.deepEqual(fallback.voiceCategories.flatMap((category) => category.channels), ['General']);

  const customPlan = createSetupPlan('Community', 'Community server for members.');
  customPlan.categories.push({ name: 'AI custom area', channels: ['project-lounge'] });
  customPlan.categories.push({ name: 'AI events', channels: ['events', 'tournaments'] });
  customPlan.roles.push({ ...customPlan.roles[1]!, name: 'Community Host' });
  const afterNo = applySetupAnswer(customPlan, 'Community', 'Community server for members.', { events: 'no' }, 'events');
  assert.ok(afterNo.categories.some((category) => category.channels.includes('project-lounge')));
  assert.ok(!afterNo.categories.flatMap((category) => category.channels).some((channel) => ['events', 'tournaments'].includes(channel)));
  assert.ok(afterNo.roles.some((role) => role.name === 'Community Host'));
});

test('malformed AI output still returns the deterministic fallback and explicit rules are generated', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    AI_API_KEY: process.env.AI_API_KEY,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_MODEL: process.env.AI_MODEL,
  };
  try {
    process.env.AI_API_KEY = 'test-placeholder';
    process.env.AI_BASE_URL = 'https://provider.invalid/v1';
    process.env.AI_MODEL = 'mock-model';
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not valid JSON' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const [type, description] = cases[0]!;
    assert.deepEqual(await generateSetupPlan(type, description), createSetupPlan(type, description));
    const rulesPlan = createSetupPlan('Creator', 'Create a rules channel for my creator community and keep the rules short and friendly.');
    assert.ok(rulesPlan.categories.some((category) => category.channels.includes('rules')));
    assert.ok(rulesPlan.rules.length > 0 && rulesPlan.rules.length <= 5);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('rules are posted only to a newly created rules channel', async () => {
  async function createStructure(reuseRules: boolean) {
    let nextId = 0;
    const sent: string[] = [];
    const channels = new Collection<string, { id: string; name: string; type: ChannelType; send?: (payload: { content: string }) => Promise<void> }>();
    if (reuseRules) channels.set('existing-rules', { id: 'existing-rules', name: 'rules', type: ChannelType.GuildText });
    const guild = {
      channels: {
        fetch: async () => channels,
        create: async (options: { name: string; type: ChannelType }) => {
          const channel = {
            id: `channel-${++nextId}`,
            name: options.name,
            type: options.type,
            send: async (payload: { content: string }) => { sent.push(payload.content); },
          };
          channels.set(channel.id, channel);
          return channel;
        },
      },
      roles: {
        fetch: async () => new Collection(),
        create: async (options: { name: string; permissions: bigint }) => ({
          id: `role-${++nextId}`,
          name: options.name,
          permissions: { bitfield: options.permissions },
        }),
      },
    };
    const plan = createSetupPlan('Community', 'Create a rules channel and keep the rules short and friendly.');
    await createSetupStructure(guild as never, plan);
    return sent;
  }

  const createdRulesMessages = await createStructure(false);
  assert.equal(createdRulesMessages.length, 1);
  assert.match(createdRulesMessages[0] ?? '', /Server Rules/);
  assert.equal((await createStructure(true)).length, 0);
});
