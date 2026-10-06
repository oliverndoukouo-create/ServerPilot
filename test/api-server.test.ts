import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApiServer, createDashboardFeatureHandlers, type ApiAuthentication, type ApiPrincipal, type GuildFeatureHandler } from '../src/api/server.js';
import { AutomationService } from '../src/automation/service.js';
import { InMemoryAutomationRepository } from '../src/automation/store.js';
import type { Automation } from '../src/automation/types.js';
import { InMemoryWelcomeRepository, WelcomeService } from '../src/welcome/store.js';
import { InMemoryModerationRepository, ModerationService } from '../src/moderation/store.js';
import { InMemoryTicketRepository, TicketService } from '../src/tickets/records.js';
import { createSetupPlan } from '../src/setup/planner.js';
import { InMemoryGuildRepository } from '../src/guilds/repository.js';
import type { GuildRepository } from '../src/guilds/repository.js';

const principal: ApiPrincipal = { discordUserId: '12345678901234567', username: 'operator' };
const guildId = '23456789012345678';
const otherGuildId = '23456789012345679';

async function withApi(
  authentication: ApiAuthentication,
  features?: Record<string, GuildFeatureHandler>,
  action: (baseUrl: string) => Promise<void> = async () => {},
  guildRepository?: GuildRepository,
) {
  const server = createApiServer({
    authentication,
    ...(features ? { features } : {}),
    ...(guildRepository ? { guildRepository } : {}),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await action(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function authentication(overrides: Partial<ApiAuthentication> = {}): ApiAuthentication {
  return {
    async authenticate() { return principal; },
    async listManagedGuilds() { return [{ id: guildId, name: 'Verified Server' }]; },
    async canManageGuild(_request, _principal, requestedGuildId) { return requestedGuildId === guildId; },
    async validateCsrf() { return true; },
    ...overrides,
  };
}

test('API health reveals configuration state without credentials and guild listing requires auth', async () => {
  await withApi(authentication({
    async authenticate() { return undefined; },
  }), undefined, async (baseUrl) => {
    const healthResponse = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json() as { services: Record<string, string> };
    assert.equal(health.services.stripe, 'not_configured');
    assert.equal(JSON.stringify(health).includes('secret'), false);

    const guildResponse = await fetch(`${baseUrl}/api/v1/guilds`);
    assert.equal(guildResponse.status, 401);
    assert.deepEqual(await guildResponse.json(), { error: 'authentication_required' });
  });
});

test('dashboard shell serves only fixed same-origin assets with a restrictive content policy', async () => {
  await withApi(authentication(), undefined, async (baseUrl) => {
    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    const html = await page.text();
    assert.match(html, /ServerPilot Dashboard/);
    assert.match(html, /server-select/);
    assert.doesNotMatch(html, /<script[^>]*>[^<]+<\/script>/);

    const stylesheet = await fetch(`${baseUrl}/dashboard.css`);
    assert.equal(stylesheet.status, 200);
    assert.match(await stylesheet.text(), /data-theme="light"/);

    const application = await fetch(`${baseUrl}/dashboard.js`);
    assert.equal(application.status, 200);
    assert.match(await application.text(), /\/api\/v1\/guilds/);

    const unsupportedAsset = await fetch(`${baseUrl}/dashboard.js.map`);
    assert.equal(unsupportedAsset.status, 404);
    const wrongMethod = await fetch(baseUrl, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
  });
});

test('managed guild listing persists membership snapshots without returning permission bits', async () => {
  const auth = authentication({
    async listManagedGuilds() {
      return [{
        id: guildId,
        name: 'Verified Server',
        owner: true,
        permissions: '0',
        approximateMemberCount: 24,
      }];
    },
  });
  const repository = new InMemoryGuildRepository();
  await withApi(auth, undefined, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/guilds`);
    assert.equal(response.status, 200);
    const body = await response.json() as { guilds: Array<Record<string, unknown>> };
    assert.deepEqual(body.guilds, [{ id: guildId, name: 'Verified Server', approximateMemberCount: 24 }]);
    assert.equal(repository.guilds.get(guildId)?.name, 'Verified Server');
    assert.equal(repository.memberships.get(`${guildId}:${principal.discordUserId}`)?.owner, true);
  }, repository);
});

test('guild-scoped API rejects unauthorized IDs before feature handlers and fails unavailable features explicitly', async () => {
  let handlerCalls = 0;
  const feature: GuildFeatureHandler = {
    async handle() {
      handlerCalls += 1;
      return { status: 200, body: { working: true } };
    },
  };
  await withApi(authentication(), { overview: feature }, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/v1/guilds/not-a-snowflake/overview`);
    assert.equal(invalid.status, 400);

    const unauthorized = await fetch(`${baseUrl}/api/v1/guilds/23456789012345679/overview`);
    assert.equal(unauthorized.status, 403);
    assert.equal(handlerCalls, 0);

    const unimplemented = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/billing`);
    assert.equal(unimplemented.status, 501);
    assert.equal((await unimplemented.json() as { error: string }).error, 'feature_unavailable');

    const working = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/overview`);
    assert.equal(working.status, 200);
    assert.equal(handlerCalls, 1);
  });
});

test('dashboard automation API reuses the service, scopes resources by guild, and validates mutations', async () => {
  const automationService = new AutomationService(new InMemoryAutomationRepository());
  const automation: Automation = {
    id: 'auto_existing_1',
    guildId,
    name: 'Welcome new members',
    enabled: true,
    trigger: { type: 'MEMBER_JOIN' },
    conditions: [],
    actions: [{ type: 'SEND_MESSAGE', channelId: '23456789012345670', message: 'Welcome {user}' }],
    createdAt: 1,
  };
  await automationService.create(automation);
  const auth = authentication({
    async listManagedGuilds() {
      return [
        { id: guildId, name: 'Verified Server' },
        { id: otherGuildId, name: 'Second Verified Server' },
      ];
    },
    async canManageGuild(_request, _principal, requestedGuildId) {
      return [guildId, otherGuildId].includes(requestedGuildId);
    },
  });
  const features = createDashboardFeatureHandlers({ automationService, authentication: auth });
  await withApi(auth, features, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/automations`);
    assert.equal(list.status, 200);
    assert.deepEqual((await list.json() as { automations: Automation[] }).automations, [automation]);

    const item = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/automations/${automation.id}`);
    assert.equal(item.status, 200);
    assert.deepEqual((await item.json() as { automation: Automation }).automation, automation);

    const crossGuildRead = await fetch(`${baseUrl}/api/v1/guilds/${otherGuildId}/automations/${automation.id}`);
    assert.equal(crossGuildRead.status, 404);
    const crossGuildUpdate = await fetch(`${baseUrl}/api/v1/guilds/${otherGuildId}/automations/${automation.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(crossGuildUpdate.status, 404);
    assert.equal((await automationService.get(automation.id, guildId))?.enabled, true);

    const invalidUpdate = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/automations/${automation.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, guildId: otherGuildId }),
    });
    assert.equal(invalidUpdate.status, 400);

    const disabled = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/automations/${automation.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(disabled.status, 200);
    assert.equal((await automationService.get(automation.id, guildId))?.enabled, false);

    const unconfirmedDelete = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/automations/${automation.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: false }),
    });
    assert.equal(unconfirmedDelete.status, 400);

    const deleted = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/automations/${automation.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    assert.equal(deleted.status, 200);
    assert.equal(await automationService.get(automation.id, guildId), undefined);
  });
});

test('dashboard overview returns authorized guild, automation, and ticket counts', async () => {
  const automationService = new AutomationService(new InMemoryAutomationRepository());
  const ticketService = new TicketService(new InMemoryTicketRepository());
  await automationService.create({
    id: 'auto_overview',
    guildId,
    name: 'Join message',
    enabled: true,
    trigger: { type: 'MEMBER_JOIN' },
    conditions: [],
    actions: [{ type: 'SEND_MESSAGE', channelId: '23456789012345670', message: 'Welcome' }],
    createdAt: 1,
  });
  await ticketService.open(guildId, '23456789012345671', principal.discordUserId);
  const auth = authentication({
    async listManagedGuilds() {
      return [{ id: guildId, name: 'Verified Server', approximateMemberCount: 42 }];
    },
  });
  const features = createDashboardFeatureHandlers({ automationService, ticketService, authentication: auth });
  await withApi(auth, features, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/overview`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      guild: {
        id: guildId,
        name: 'Verified Server',
        memberCount: { value: 42, kind: 'discord_approximate' },
      },
      automations: { total: 1, enabled: 1 },
      tickets: { open: 1 },
      moderation: { status: 'not_available_yet' },
    });
  });
});

test('dashboard ticket history uses the guild-scoped ticket service and bounds the requested limit', async () => {
  const auth = authentication({
    async listManagedGuilds() {
      return [
        { id: guildId, name: 'Verified Server' },
        { id: otherGuildId, name: 'Second Verified Server' },
      ];
    },
    async canManageGuild(_request, _principal, requestedGuildId) {
      return [guildId, otherGuildId].includes(requestedGuildId);
    },
  });
  const ticketService = new TicketService(new InMemoryTicketRepository());
  await ticketService.open(guildId, '23456789012345670', principal.discordUserId);
  const features = createDashboardFeatureHandlers({ ticketService, authentication: auth });
  await withApi(auth, features, async (baseUrl) => {
    const tickets = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/tickets?limit=20`);
    assert.equal(tickets.status, 200);
    assert.equal((await tickets.json() as { tickets: Array<{ guildId: string }> }).tickets[0]?.guildId, guildId);

    const otherGuildTickets = await fetch(`${baseUrl}/api/v1/guilds/${otherGuildId}/tickets`);
    assert.equal(otherGuildTickets.status, 200);
    assert.deepEqual((await otherGuildTickets.json() as { tickets: unknown[] }).tickets, []);

    const invalidLimit = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/tickets?limit=101`);
    assert.equal(invalidLimit.status, 400);
  });
});

test('dashboard reads only the authorized guild welcome configuration', async () => {
  const auth = authentication({
    async listManagedGuilds() {
      return [
        { id: guildId, name: 'Verified Server' },
        { id: otherGuildId, name: 'Second Verified Server' },
      ];
    },
    async canManageGuild(_request, _principal, requestedGuildId) {
      return [guildId, otherGuildId].includes(requestedGuildId);
    },
  });
  const welcomeService = new WelcomeService(new InMemoryWelcomeRepository());
  await welcomeService.save({
    guildId,
    channelId: '23456789012345670',
    message: 'Welcome {user}',
    enabled: true,
  });
  const features = createDashboardFeatureHandlers({ welcomeService, authentication: auth });
  await withApi(auth, features, async (baseUrl) => {
    const ownConfiguration = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/welcome/config`);
    assert.equal(ownConfiguration.status, 200);
    assert.deepEqual((await ownConfiguration.json() as { configuration: unknown }).configuration, {
      guildId,
      channelId: '23456789012345670',
      message: 'Welcome {user}',
      enabled: true,
    });

    const crossGuildConfiguration = await fetch(`${baseUrl}/api/v1/guilds/${otherGuildId}/welcome/config`);
    assert.equal(crossGuildConfiguration.status, 200);
    assert.deepEqual((await crossGuildConfiguration.json() as { configuration: unknown }).configuration, null);

    const mutation = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/welcome/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(mutation.status, 405);
  });
});

test('dashboard moderation history is guild-scoped and mutation endpoints remain unavailable', async () => {
  const auth = authentication({
    async canManageGuild(_request, _principal, requestedGuildId) {
      return requestedGuildId === guildId;
    },
  });
  const moderationService = new ModerationService(new InMemoryModerationRepository());
  await moderationService.record({
    guildId,
    targetUserId: '23456789012345670',
    moderatorUserId: principal.discordUserId,
    action: 'warn',
    reason: 'Test case',
  });
  const features = createDashboardFeatureHandlers({ moderationService, authentication: auth });
  await withApi(auth, features, async (baseUrl) => {
    const history = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/moderation/cases`);
    assert.equal(history.status, 200);
    assert.equal((await history.json() as { cases: unknown[] }).cases.length, 1);

    const crossGuild = await fetch(`${baseUrl}/api/v1/guilds/${otherGuildId}/moderation/cases`);
    assert.equal(crossGuild.status, 403);

    const outOfRange = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/moderation/cases?limit=1000`);
    assert.equal(outOfRange.status, 400);

    const attemptedAction = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/moderation/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'ban', targetUserId: '23456789012345670' }),
    });
    assert.equal(attemptedAction.status, 501);
  });
});

test('dashboard server builder uses the existing safe planner and never applies Discord changes', async () => {
  let plannerCalls = 0;
  const auth = authentication();
  const features = createDashboardFeatureHandlers({
    authentication: auth,
    async setupPlanner(type, description) {
      plannerCalls += 1;
      return createSetupPlan(type, description);
    },
  });
  await withApi(auth, features, async (baseUrl) => {
    const invalid = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/setup/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'Community', description: 'A community server description', guildId: otherGuildId }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(plannerCalls, 0);

    const planned = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/setup/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'Community', description: 'A community server description' }),
    });
    assert.equal(planned.status, 200);
    const result = await planned.json() as { plan: { type: string; description: string }; applyAvailable: boolean };
    assert.equal(result.plan.type, 'Community');
    assert.equal(result.plan.description, 'A community server description');
    assert.equal(result.applyAvailable, false);
    assert.equal(plannerCalls, 1);

    const apply = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/setup/apply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan: result.plan }),
    });
    assert.equal(apply.status, 501);
  });
});

test('API validates methods, JSON content types, JSON shape, and bounded body size', async () => {
  await withApi(authentication(), undefined, async (baseUrl) => {
    const wrongMethod = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/overview`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);

    const wrongContentType = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/settings`, {
      method: 'PUT',
      body: '{}',
    });
    assert.equal(wrongContentType.status, 415);

    const invalidShape = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    });
    assert.equal(invalidShape.status, 400);

    const oversizedBody = `{"value":"${'x'.repeat(64 * 1024)}"}`;
    const tooLarge = await fetch(`${baseUrl}/api/v1/guilds/${guildId}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: oversizedBody,
    });
    assert.equal(tooLarge.status, 413);
  });
});
