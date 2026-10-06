import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { getSupabaseClient, readSupabaseConfiguration } from '../db.js';
import {
  DiscordOAuthRequestError,
  DiscordOAuthService,
  OAuthPersistenceError,
  readDiscordOAuthConfiguration,
  SupabaseOAuthSessionRepository,
} from './oauth.js';
import { GuildPersistenceError, SupabaseGuildRepository, type GuildRepository } from '../guilds/repository.js';
import { AutomationService } from '../automation/service.js';
import { AutomationPersistenceError, SupabaseAutomationRepository } from '../automation/supabase-repository.js';
import type { Automation } from '../automation/types.js';
import { SupabaseWelcomeRepository, WelcomePersistenceError, WelcomeService } from '../welcome/store.js';
import { SupabaseTicketConfigurationRepository, TicketConfigurationService, TicketPersistenceError } from '../tickets/store.js';
import { SupabaseTicketRepository, TicketRecordPersistenceError, TicketService } from '../tickets/records.js';
import { ModerationPersistenceError, ModerationService, SupabaseModerationRepository } from '../moderation/store.js';
import { generateSetupPlan } from '../ai/planner.js';
import { setupTypes, type SetupType } from '../setup/types.js';

const apiPrefix = '/api/v1';
const maximumBodyBytes = 64 * 1024;
const snowflakePattern = /^\d{17,20}$/;
const methodsByRoute = new Map<string, readonly string[]>([
  ['overview', ['GET']],
  ['settings', ['GET', 'PUT']],
  ['setup/plan', ['POST']],
  ['setup/apply', ['POST']],
  ['automations', ['GET']],
  ['welcome/config', ['GET']],
  ['tickets/config', ['GET']],
  ['moderation/cases', ['GET']],
  ['moderation/actions', ['POST']],
  ['tickets', ['GET']],
  ['xp/config', ['GET', 'PUT']],
  ['xp/leaderboard', ['GET']],
  ['analytics/summary', ['GET']],
  ['analytics/trends', ['GET']],
  ['billing', ['GET']],
  ['billing/checkout', ['POST']],
]);

function adapterErrorCode(error: unknown) {
  if (error instanceof DiscordOAuthRequestError) return 'discord_api_error';
  if (error instanceof OAuthPersistenceError
    || error instanceof GuildPersistenceError
    || error instanceof AutomationPersistenceError
    || error instanceof WelcomePersistenceError
    || error instanceof TicketPersistenceError
    || error instanceof TicketRecordPersistenceError
    || error instanceof ModerationPersistenceError) return 'database_error';
  return undefined;
}

export type ApiPrincipal = {
  discordUserId: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
};

export type ManagedGuild = {
  id: string;
  name: string;
  iconUrl?: string;
  iconHash?: string;
  approximateMemberCount?: number;
  owner?: boolean;
  permissions?: string;
};

export interface ApiAuthentication {
  authenticate(request: IncomingMessage): Promise<ApiPrincipal | undefined>;
  listManagedGuilds(request: IncomingMessage, principal: ApiPrincipal): Promise<ManagedGuild[]>;
  canManageGuild(request: IncomingMessage, principal: ApiPrincipal, guildId: string): Promise<boolean>;
  validateCsrf(request: IncomingMessage): Promise<boolean>;
}

export interface OAuthRouteHandlers {
  start(request: IncomingMessage, response: ServerResponse): Promise<void>;
  callback(request: IncomingMessage, response: ServerResponse): Promise<void>;
  logout(request: IncomingMessage, response: ServerResponse): Promise<void>;
}

export type GuildFeatureContext = {
  request: IncomingMessage;
  principal: ApiPrincipal;
  guildId: string;
  route: string;
  method: string;
  query: URLSearchParams;
  body: unknown;
};

export interface GuildFeatureHandler {
  handle(context: GuildFeatureContext): Promise<{ status: number; body: unknown }>;
}

export type ApiDependencies = {
  authentication: ApiAuthentication;
  features?: Partial<Record<string, GuildFeatureHandler>>;
  guildRepository?: GuildRepository;
  databaseStatus?: 'not_configured' | 'configured_not_verified';
  discordOAuthStatus?: 'not_configured' | 'configured_not_verified' | 'storage_unavailable';
  oauth?: OAuthRouteHandlers;
};

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  response.end(JSON.stringify(body));
}

const dashboardAssets = new Map([
  ['/', { file: new URL('../dashboard/index.html', import.meta.url), contentType: 'text/html; charset=utf-8' }],
  ['/dashboard.css', { file: new URL('../dashboard/dashboard.css', import.meta.url), contentType: 'text/css; charset=utf-8' }],
  ['/dashboard.js', { file: new URL('../dashboard/dashboard.js', import.meta.url), contentType: 'text/javascript; charset=utf-8' }],
]);

async function serveDashboardAsset(pathname: string, response: ServerResponse) {
  const asset = dashboardAssets.get(pathname);
  if (!asset) return false;
  let content: Buffer;
  try {
    content = await readFile(asset.file);
  } catch (error) {
    console.error('Dashboard asset failed to load.', error instanceof Error ? error.name : 'UnknownError');
    sendJson(response, 503, { error: 'dashboard_unavailable' });
    return true;
  }
  response.writeHead(200, {
    'Content-Type': asset.contentType,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.discordapp.com; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  response.end(content);
  return true;
}

function isJsonMethod(method: string) {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

async function readJsonBody(request: IncomingMessage): Promise<{ body?: unknown; error?: { status: number; message: string } }> {
  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maximumBodyBytes) {
    request.resume();
    return { error: { status: 413, message: 'Request body is too large.' } };
  }
  if (!isJsonMethod(request.method ?? '')) return { body: undefined };
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    return { error: { status: 415, message: 'Content-Type must be application/json.' } };
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maximumBodyBytes) {
      request.resume();
      return { error: { status: 413, message: 'Request body is too large.' } };
    }
    chunks.push(buffer);
  }
  if (bytes === 0) return { error: { status: 400, message: 'A JSON request body is required.' } };
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { error: { status: 400, message: 'JSON request body must be an object.' } };
    }
    return { body };
  } catch {
    return { error: { status: 400, message: 'Request body contains invalid JSON.' } };
  }
}

function unavailable(feature: string) {
  return {
    error: 'feature_unavailable',
    feature,
    message: 'This ServerPilot feature is not connected to an implemented service yet.',
  };
}

async function handleRequest(request: IncomingMessage, response: ServerResponse, dependencies: ApiDependencies) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const method = request.method ?? 'GET';
  if (!url.pathname.startsWith(apiPrefix)) {
    if (dashboardAssets.has(url.pathname)) {
      if (method !== 'GET') {
        response.setHeader('Allow', 'GET');
        sendJson(response, 405, { error: 'method_not_allowed' });
        return;
      }
      await serveDashboardAsset(url.pathname, response);
      return;
    }
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  if (url.pathname === `${apiPrefix}/health` && method === 'GET') {
    let databaseStatus = dependencies.databaseStatus;
    if (!databaseStatus) {
      databaseStatus = readSupabaseConfiguration(process.env)
        ? 'configured_not_verified'
        : 'not_configured';
    }
    sendJson(response, 200, {
      status: 'ok',
      services: {
        database: databaseStatus,
        discordOAuth: dependencies.discordOAuthStatus ?? 'not_configured',
        stripe: 'not_configured',
      },
    });
    return;
  }

  if (url.pathname === `${apiPrefix}/auth/discord` && method === 'GET') {
    if (!dependencies.oauth) {
      sendJson(response, 503, { error: 'discord_oauth_not_configured' });
      return;
    }
    await dependencies.oauth.start(request, response);
    return;
  }
  if (url.pathname === `${apiPrefix}/auth/discord/callback` && method === 'GET') {
    if (!dependencies.oauth) {
      sendJson(response, 503, { error: 'discord_oauth_not_configured' });
      return;
    }
    await dependencies.oauth.callback(request, response);
    return;
  }

  let principal: ApiPrincipal | undefined;
  try {
    principal = await dependencies.authentication.authenticate(request);
  } catch (error) {
    console.error('API authentication adapter failed.', error instanceof Error ? error.name : 'UnknownError');
    sendJson(response, 503, { error: adapterErrorCode(error) ?? 'authentication_unavailable' });
    return;
  }
  if (!principal) {
    sendJson(response, 401, { error: 'authentication_required' });
    return;
  }

  if (method !== 'GET' && !await dependencies.authentication.validateCsrf(request)) {
    sendJson(response, 403, { error: 'csrf_validation_failed' });
    return;
  }

  if (url.pathname === `${apiPrefix}/auth/logout` && method === 'POST') {
    if (!dependencies.oauth) {
      sendJson(response, 503, { error: 'discord_oauth_not_configured' });
      return;
    }
    await dependencies.oauth.logout(request, response);
    return;
  }

  if (url.pathname === `${apiPrefix}/me` && method === 'GET') {
    sendJson(response, 200, { user: principal });
    return;
  }
  if (url.pathname === `${apiPrefix}/guilds` && method === 'GET') {
    try {
      const guilds = await dependencies.authentication.listManagedGuilds(request, principal);
      if (dependencies.guildRepository) {
        await dependencies.guildRepository.ensureGuilds(guilds.map((guild) => ({
          id: guild.id,
          name: guild.name,
          ...(guild.iconHash ? { iconHash: guild.iconHash } : {}),
          ...(guild.owner ? { ownerUserId: principal.discordUserId } : {}),
        })));
        await dependencies.guildRepository.syncManagedMemberships(principal.discordUserId, guilds);
      }
      sendJson(response, 200, {
        guilds: guilds.map(({ permissions: _permissions, owner: _owner, iconHash: _iconHash, ...guild }) => guild),
      });
    } catch (error) {
      console.error('Guild listing service failed.', error instanceof Error ? error.name : 'UnknownError');
      sendJson(response, 503, {
        error: adapterErrorCode(error) ?? 'guild_listing_unavailable',
      });
    }
    return;
  }

  const guildMatch = url.pathname.match(/^\/api\/v1\/guilds\/([^/]+)\/(.+)$/);
  if (!guildMatch) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }

  let guildId: string;
  try {
    guildId = decodeURIComponent(guildMatch[1] ?? '');
  } catch {
    sendJson(response, 400, { error: 'invalid_guild_id' });
    return;
  }
  const route = guildMatch[2] ?? '';
  if (!snowflakePattern.test(guildId)) {
    sendJson(response, 400, { error: 'invalid_guild_id' });
    return;
  }

  const dynamicAutomation = route.match(/^automations\/([^/]+)$/);
  const routeKey = dynamicAutomation ? 'automations/:automationId' : route;
  const supportedMethods = dynamicAutomation
    ? ['GET', 'PATCH', 'DELETE']
    : methodsByRoute.get(route);
  if (!supportedMethods) {
    sendJson(response, 404, { error: 'not_found' });
    return;
  }
  if (!supportedMethods.includes(method)) {
    response.setHeader('Allow', supportedMethods.join(', '));
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }

  try {
    if (!await dependencies.authentication.canManageGuild(request, principal, guildId)) {
      sendJson(response, 403, { error: 'guild_access_denied' });
      return;
    }
  } catch (error) {
    console.error('Guild authorization adapter failed.', error instanceof Error ? error.name : 'UnknownError');
    sendJson(response, 503, { error: adapterErrorCode(error) ?? 'guild_authorization_unavailable' });
    return;
  }

  const parsed = await readJsonBody(request);
  if (parsed.error) {
    sendJson(response, parsed.error.status, { error: 'invalid_request', message: parsed.error.message });
    return;
  }

  const feature = routeKey.split('/')[0] ?? routeKey;
  const handler = dependencies.features?.[feature];
  if (!handler) {
    sendJson(response, 501, unavailable(feature));
    return;
  }
  try {
    const result = await handler.handle({
    request,
    principal,
      guildId,
    route,
      method,
      query: url.searchParams,
      body: parsed.body,
    });
    sendJson(response, result.status, result.body);
  } catch (error) {
    if (error instanceof FeatureError) {
    sendJson(response, error.status, { error: error.code, message: error.message });
    return;
    }
    console.error('API feature handler failed.', error instanceof Error ? error.name : 'UnknownError');
    const code = adapterErrorCode(error);
    sendJson(response, code ? 503 : 500, { error: code ?? 'request_failed' });
  }
}

export function createApiServer(dependencies: ApiDependencies): Server {
  return createServer((request, response) => {
    void handleRequest(request, response, dependencies).catch((error: unknown) => {
      console.error('API request failed.', error instanceof Error ? error.name : 'UnknownError');
      if (!response.headersSent) sendJson(response, 500, { error: 'request_failed' });
      else response.destroy();
    });
  });
}

const unauthenticatedAdapter: ApiAuthentication = {
  async authenticate() {
    return undefined;
  },
  async listManagedGuilds() {
    throw new Error('Discord OAuth is not configured.');
  },
  async canManageGuild() {
    return false;
  },
  async validateCsrf() {
    return false;
  },
};

export function createUnconfiguredApiServer() {
  const configuration = readSupabaseConfiguration(process.env);
  const supabase = getSupabaseClient();
  const oauthConfiguration = readDiscordOAuthConfiguration(process.env);
  const oauth = oauthConfiguration && supabase
    ? new DiscordOAuthService(oauthConfiguration, new SupabaseOAuthSessionRepository(supabase))
    : undefined;
  const automationService = supabase
    ? new AutomationService(new SupabaseAutomationRepository(supabase))
    : undefined;
  const welcomeService = supabase
    ? new WelcomeService(new SupabaseWelcomeRepository(supabase))
    : undefined;
  const ticketConfigurationService = supabase
    ? new TicketConfigurationService(new SupabaseTicketConfigurationRepository(supabase))
    : undefined;
  const ticketService = supabase
    ? new TicketService(new SupabaseTicketRepository(supabase))
    : undefined;
  const moderationService = supabase
    ? new ModerationService(new SupabaseModerationRepository(supabase))
    : undefined;
  const features = createDashboardFeatureHandlers({
    ...(automationService ? { automationService } : {}),
    ...(welcomeService ? { welcomeService } : {}),
    ...(ticketConfigurationService ? { ticketConfigurationService } : {}),
    ...(ticketService ? { ticketService } : {}),
    ...(moderationService ? { moderationService } : {}),
    authentication: oauth ?? unauthenticatedAdapter,
  });
  return createApiServer({
    authentication: oauth ?? unauthenticatedAdapter,
    ...(supabase ? { guildRepository: new SupabaseGuildRepository(supabase) } : {}),
    features,
    ...(oauth ? { oauth } : {}),
    databaseStatus: configuration ? 'configured_not_verified' : 'not_configured',
    discordOAuthStatus: oauth
      ? 'configured_not_verified'
      : oauthConfiguration
        ? 'storage_unavailable'
        : 'not_configured',
  });
}

export type DashboardFeatureServices = {
  automationService?: AutomationService;
  welcomeService?: WelcomeService;
  ticketConfigurationService?: TicketConfigurationService;
  ticketService?: TicketService;
  moderationService?: ModerationService;
  setupPlanner?: typeof generateSetupPlan;
  authentication: ApiAuthentication;
};

class FeatureError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'FeatureError';
  }
}

export function createDashboardFeatureHandlers(services: DashboardFeatureServices): Partial<Record<string, GuildFeatureHandler>> {
  return {
    overview: {
      async handle(context) {
        const guild = (await services.authentication.listManagedGuilds(context.request, context.principal))
          .find((managedGuild) => managedGuild.id === context.guildId);
        if (!guild) throw new FeatureError('Guild access is no longer available.', 403, 'guild_access_denied');
        let automations: Automation[] | undefined;
        if (services.automationService) {
          automations = await services.automationService.listForGuild(context.guildId);
        }
        const openTickets = services.ticketService
          ? await services.ticketService.countOpenForGuild(context.guildId)
          : undefined;
        return {
          status: 200,
          body: {
            guild: {
              id: guild.id,
              name: guild.name,
              ...(guild.iconUrl ? { iconUrl: guild.iconUrl } : {}),
              ...(typeof guild.approximateMemberCount === 'number'
                ? { memberCount: { value: guild.approximateMemberCount, kind: 'discord_approximate' } }
                : { memberCount: { value: null, kind: 'unavailable' } }),
            },
            automations: automations
              ? { total: automations.length, enabled: automations.filter((automation) => automation.enabled).length }
              : { status: 'not_configured' },
            tickets: openTickets === undefined ? { status: 'not_configured' } : { open: openTickets },
            moderation: { status: 'not_available_yet' },
          },
        };
      },
    },
    'setup': {
      async handle(context) {
        if (context.route !== 'setup/plan' || context.method !== 'POST') {
          throw new FeatureError('Discord resource creation still requires the existing reviewed Discord interaction flow.', 501, 'not_implemented');
        }
        if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
          throw new FeatureError('Setup plan request must be an object.', 400, 'validation_error');
        }
        const body = context.body as Record<string, unknown>;
        if (Object.keys(body).length !== 2
          || typeof body.type !== 'string'
          || !setupTypes.includes(body.type as SetupType)
          || typeof body.description !== 'string'
          || body.description.trim().length < 10
          || body.description.length > 1000) {
          throw new FeatureError('Provide a supported community type and a description between 10 and 1000 characters.', 400, 'validation_error');
        }
        const plan = await (services.setupPlanner ?? generateSetupPlan)(body.type as SetupType, body.description.trim());
        return { status: 200, body: { plan, applyAvailable: false } };
      },
    },
    automations: {
      async handle(context) {
        if (!services.automationService) {
          return {
            status: 503,
            body: {
              error: 'persistence_not_configured',
              message: 'Automation storage is unavailable until the server database is configured.',
            },
          };
        }
        const resource = context.route.match(/^automations\/([^/]+)$/);
        if (!resource) {
          if (context.method !== 'GET') {
            throw new FeatureError('Automation creation is only available through the validated Discord proposal flow.', 501, 'not_implemented');
          }
          const automations = await services.automationService.listForGuild(context.guildId);
          return { status: 200, body: { automations } };
        }

        let id: string;
        try {
          id = decodeURIComponent(resource[1] ?? '');
        } catch {
          throw new FeatureError('Automation ID is invalid.', 400, 'invalid_automation_id');
        }
        if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
          throw new FeatureError('Automation ID is invalid.', 400, 'invalid_automation_id');
        }
        const automation = await services.automationService.get(id, context.guildId);
        if (!automation) throw new FeatureError('Automation was not found in this server.', 404, 'not_found');

        if (context.method === 'GET') return { status: 200, body: { automation } };
        if (context.method === 'PATCH') {
          if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)) {
            throw new FeatureError('Automation update must be an object.', 400, 'validation_error');
          }
          const body = context.body as Record<string, unknown>;
          if (Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') {
            throw new FeatureError('Only the enabled boolean may be changed through this endpoint.', 400, 'validation_error');
          }
          const updated = await services.automationService.setEnabled(id, context.guildId, body.enabled);
          if (!updated) throw new FeatureError('Automation was not found in this server.', 404, 'not_found');
          return { status: 200, body: { automation: updated } };
        }
        if (context.method === 'DELETE') {
          if (!context.body || typeof context.body !== 'object' || Array.isArray(context.body)
            || Object.keys(context.body).length !== 1
            || (context.body as Record<string, unknown>).confirm !== true) {
            throw new FeatureError('Confirm automation deletion explicitly.', 400, 'confirmation_required');
          }
          const deleted = await services.automationService.delete(id, context.guildId);
          if (!deleted) throw new FeatureError('Automation was not found in this server.', 404, 'not_found');
          return { status: 200, body: { deleted: true } };
        }
        throw new FeatureError('Automation operation is not available.', 405, 'method_not_allowed');
      },
    },
    welcome: {
      async handle(context) {
        if (!services.welcomeService) {
          return {
            status: 503,
            body: {
              error: 'persistence_not_configured',
              message: 'Welcome configuration storage is unavailable until the server database is configured.',
            },
          };
        }
        if (context.route !== 'welcome/config' || context.method !== 'GET') {
          throw new FeatureError('Welcome configuration is read-only in the dashboard until a validated Discord configuration action is available.', 501, 'not_implemented');
        }
        const configuration = await services.welcomeService.get(context.guildId);
        return { status: 200, body: { configuration: configuration ?? null } };
      },
    },
    tickets: {
      async handle(context) {
        if (context.method !== 'GET') {
          throw new FeatureError('Ticket configuration changes are not available from the dashboard.', 501, 'not_implemented');
        }
        if (context.route === 'tickets/config') {
          if (!services.ticketConfigurationService) {
            return {
              status: 503,
              body: {
                error: 'persistence_not_configured',
                message: 'Ticket configuration storage is unavailable until the server database is configured and migrations are applied.',
              },
            };
          }
          const configuration = await services.ticketConfigurationService.get(context.guildId);
          return { status: 200, body: { configuration: configuration ?? null } };
        }
        if (context.route === 'tickets' && services.ticketService) {
          const rawLimit = context.query.get('limit');
          const limit = rawLimit === null ? 50 : Number(rawLimit);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            throw new FeatureError('Limit must be an integer between 1 and 100.', 400, 'validation_error');
          }
          const tickets = await services.ticketService.listForGuild(context.guildId, limit);
          return { status: 200, body: { tickets } };
        }
        if (context.route === 'tickets') {
          return {
            status: 503,
            body: {
              error: 'persistence_not_configured',
              message: 'Ticket history storage is unavailable until the server database is configured and migrations are applied.',
            },
          };
        }
        throw new FeatureError('Ticket route is not available.', 404, 'not_found');
      },
    },
    moderation: {
      async handle(context) {
        if (!services.moderationService) {
          return {
            status: 503,
            body: {
              error: 'persistence_not_configured',
              message: 'Moderation history storage is unavailable until the server database is configured and migrations are applied.',
            },
          };
        }
        if (context.route !== 'moderation/cases' || context.method !== 'GET') {
          throw new FeatureError('Dashboard moderation actions are not available; continue using the permission-checked Discord commands.', 501, 'not_implemented');
        }
        const rawLimit = context.query.get('limit');
        const limit = rawLimit === null ? 50 : Number(rawLimit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new FeatureError('Limit must be an integer between 1 and 100.', 400, 'validation_error');
        }
        const cases = await services.moderationService.listForGuild(context.guildId, limit);
        return { status: 200, body: { cases } };
      },
    },
  };
}

async function main() {
  const server = createUnconfiguredApiServer();
  const rawPort = process.env.API_PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535.');
  }
  const host = process.env.API_HOST ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  console.log(`ServerPilot API listening on ${host}:${port}; dashboard features remain unavailable until their services are configured.`);
}

const currentFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === currentFile) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'API startup failed.');
    process.exitCode = 1;
  });
}
