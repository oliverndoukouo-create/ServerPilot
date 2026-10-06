import type { SupabaseClient } from '@supabase/supabase-js';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ApiAuthentication, ApiPrincipal, ManagedGuild, OAuthRouteHandlers } from './server.js';

const discordApi = 'https://discord.com/api/v10';
const stateCookieName = 'sp_oauth_state';
const sessionCookieName = 'sp_session';
const csrfCookieName = 'sp_csrf';
const stateLifetimeMs = 5 * 60 * 1000;
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const guildManagePermission = 1n << 5n;
const administratorPermission = 1n << 3n;

export type DiscordOAuthConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  publicOrigin: string;
  encryptionKey: Buffer;
  encryptionKeyId: string;
  secureCookies: boolean;
};

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
};

type DiscordGuild = {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
  approximate_member_count?: number;
};

type OAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
};

export type OAuthSessionRecord = {
  sessionHash: string;
  csrfHash: string;
  discordUserId: string;
  username: string;
  globalName?: string;
  avatarHash?: string;
  accessTokenCiphertext: string;
  refreshTokenCiphertext?: string;
  encryptionKeyId: string;
  tokenExpiresAt: number;
  expiresAt: number;
};

export interface OAuthSessionRepository {
  createState(stateHash: string, returnPath: string, expiresAt: number): Promise<void>;
  consumeState(stateHash: string, now: number): Promise<string | undefined>;
  createSession(session: OAuthSessionRecord): Promise<void>;
  getSession(sessionHash: string, now: number): Promise<OAuthSessionRecord | undefined>;
  updateTokens(
    sessionHash: string,
    accessTokenCiphertext: string,
    refreshTokenCiphertext: string | undefined,
    encryptionKeyId: string,
    tokenExpiresAt: number,
  ): Promise<void>;
  revokeSession(sessionHash: string, now: number): Promise<void>;
}

type OAuthSessionRow = {
  session_hash: string;
  csrf_token_hash: string;
  discord_user_id: string;
  access_token_ciphertext: string;
  refresh_token_ciphertext: string | null;
  encryption_key_id: string;
  token_expires_at: string;
  expires_at: string;
  user: {
    username: string;
    global_name: string | null;
    avatar_hash: string | null;
  } | null;
};

function persistenceError(operation: string, code?: string) {
  return new OAuthPersistenceError(operation, code);
}

export class OAuthPersistenceError extends Error {
  constructor(operation: string, code?: string) {
    super(`OAuth session persistence ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'OAuthPersistenceError';
  }
}

export class DiscordOAuthRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscordOAuthRequestError';
  }
}

export class SupabaseOAuthSessionRepository implements OAuthSessionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async createState(stateHash: string, returnPath: string, expiresAt: number) {
    const { error } = await this.client.from('oauth_states').insert({
      state_hash: stateHash,
      return_path: returnPath,
      expires_at: new Date(expiresAt).toISOString(),
    });
    if (error) throw persistenceError('create state', error.code);
  }

  async consumeState(stateHash: string, now: number) {
    const { data, error } = await this.client
      .from('oauth_states')
      .update({ consumed_at: new Date(now).toISOString() })
      .eq('state_hash', stateHash)
      .is('consumed_at', null)
      .gt('expires_at', new Date(now).toISOString())
      .select('return_path')
      .maybeSingle();
    if (error) throw persistenceError('consume state', error.code);
    return typeof data?.return_path === 'string' ? data.return_path : undefined;
  }

  async createSession(session: OAuthSessionRecord) {
    const { error: userError } = await this.client.from('app_users').upsert({
      discord_user_id: session.discordUserId,
      username: session.username,
      global_name: session.globalName ?? null,
      avatar_hash: session.avatarHash ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'discord_user_id' });
    if (userError) throw persistenceError('save user', userError.code);
    const { error } = await this.client.from('oauth_sessions').insert({
      session_hash: session.sessionHash,
      csrf_token_hash: session.csrfHash,
      discord_user_id: session.discordUserId,
      access_token_ciphertext: session.accessTokenCiphertext,
      refresh_token_ciphertext: session.refreshTokenCiphertext ?? null,
      encryption_key_id: session.encryptionKeyId,
      token_expires_at: new Date(session.tokenExpiresAt).toISOString(),
      expires_at: new Date(session.expiresAt).toISOString(),
    });
    if (error) throw persistenceError('create session', error.code);
  }

  async getSession(sessionHash: string, now: number) {
    const { data, error } = await this.client
      .from('oauth_sessions')
      .select('session_hash, csrf_token_hash, discord_user_id, access_token_ciphertext, refresh_token_ciphertext, encryption_key_id, token_expires_at, expires_at, user:app_users(username, global_name, avatar_hash)')
      .eq('session_hash', sessionHash)
      .is('revoked_at', null)
      .gt('expires_at', new Date(now).toISOString())
      .maybeSingle();
    if (error) throw persistenceError('read session', error.code);
    if (!data) return undefined;
    const row = data as unknown as OAuthSessionRow;
    if (!row.user) throw new Error('OAuth session refers to a missing user.');
    return {
      sessionHash: row.session_hash,
      csrfHash: row.csrf_token_hash,
      discordUserId: row.discord_user_id,
      username: row.user.username,
      ...(row.user.global_name ? { globalName: row.user.global_name } : {}),
      ...(row.user.avatar_hash ? { avatarHash: row.user.avatar_hash } : {}),
      accessTokenCiphertext: row.access_token_ciphertext,
      ...(row.refresh_token_ciphertext ? { refreshTokenCiphertext: row.refresh_token_ciphertext } : {}),
      encryptionKeyId: row.encryption_key_id,
      tokenExpiresAt: Date.parse(row.token_expires_at),
      expiresAt: Date.parse(row.expires_at),
    } satisfies OAuthSessionRecord;
  }

  async updateTokens(sessionHash: string, accessTokenCiphertext: string, refreshTokenCiphertext: string | undefined, encryptionKeyId: string, tokenExpiresAt: number) {
    const { data, error } = await this.client
      .from('oauth_sessions')
      .update({
        access_token_ciphertext: accessTokenCiphertext,
        refresh_token_ciphertext: refreshTokenCiphertext ?? null,
        encryption_key_id: encryptionKeyId,
        token_expires_at: new Date(tokenExpiresAt).toISOString(),
      })
      .eq('session_hash', sessionHash)
      .is('revoked_at', null)
      .select('session_hash')
      .maybeSingle();
    if (error) throw persistenceError('refresh session', error.code);
    if (!data) throw new Error('OAuth session expired during token refresh.');
  }

  async revokeSession(sessionHash: string, now: number) {
    const { error } = await this.client.from('oauth_sessions')
      .update({ revoked_at: new Date(now).toISOString() })
      .eq('session_hash', sessionHash)
      .is('revoked_at', null);
    if (error) throw persistenceError('revoke session', error.code);
  }
}

export function readDiscordOAuthConfiguration(environment: NodeJS.ProcessEnv): DiscordOAuthConfiguration | undefined {
  const clientId = environment.DISCORD_OAUTH_CLIENT_ID?.trim();
  const clientSecret = environment.DISCORD_OAUTH_CLIENT_SECRET?.trim();
  const redirectUri = environment.DISCORD_OAUTH_REDIRECT_URI?.trim();
  const publicOrigin = environment.DASHBOARD_PUBLIC_ORIGIN?.trim();
  const encryptionKeyText = environment.DASHBOARD_TOKEN_ENCRYPTION_KEY?.trim();
  if (![clientId, clientSecret, redirectUri, publicOrigin, encryptionKeyText].some(Boolean)) return undefined;
  if (!clientId || !clientSecret || !redirectUri || !publicOrigin || !encryptionKeyText) {
    throw new Error('Discord dashboard OAuth requires client ID, client secret, redirect URI, dashboard origin, and token encryption key.');
  }

  let callback: URL;
  let origin: URL;
  try {
    callback = new URL(redirectUri);
    origin = new URL(publicOrigin);
  } catch {
    throw new Error('Discord OAuth redirect URI and dashboard public origin must be valid URLs.');
  }
  const isLocal = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if ((callback.protocol !== 'https:' && !(callback.protocol === 'http:' && isLocal(callback)))
    || (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && isLocal(origin)))) {
    throw new Error('Discord OAuth redirect URI and dashboard origin must use HTTPS outside localhost.');
  }
  if (callback.username || callback.password || callback.search || callback.hash
    || callback.pathname !== '/api/v1/auth/discord/callback'
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('OAuth URLs must use the registered callback route and a clean dashboard origin.');
  }

  let encryptionKey: Buffer;
  try {
    encryptionKey = Buffer.from(encryptionKeyText, 'base64');
  } catch {
    throw new Error('Dashboard token encryption key must be a 32-byte base64 value.');
  }
  if (encryptionKey.length !== 32 || encryptionKey.toString('base64').replace(/=+$/, '') !== encryptionKeyText.replace(/=+$/, '')) {
    throw new Error('Dashboard token encryption key must be a 32-byte base64 value.');
  }
  return {
    clientId,
    clientSecret,
    redirectUri: callback.toString(),
    publicOrigin: origin.origin,
    encryptionKey,
    encryptionKeyId: createHash('sha256').update(encryptionKey).digest('hex').slice(0, 16),
    secureCookies: !isLocal(origin),
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function equalSecret(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encryptToken(token: string, configuration: DiscordOAuthConfiguration) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', configuration.encryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

function decryptToken(value: string, keyId: string, configuration: DiscordOAuthConfiguration) {
  if (keyId !== configuration.encryptionKeyId) {
    throw new Error('OAuth token encryption key is not available; users must sign in again.');
  }
  const [version, nonceText, tagText, ciphertextText] = value.split('.');
  if (version !== 'v1' || !nonceText || !tagText || !ciphertextText) {
    throw new Error('Stored OAuth token has an unsupported encrypted format.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', configuration.encryptionKey, Buffer.from(nonceText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new Error('Stored OAuth token could not be decrypted.');
  }
}

function cookies(request: IncomingMessage) {
  const values = new Map<string, string>();
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    values.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return values;
}

function cookie(name: string, value: string, configuration: DiscordOAuthConfiguration, maxAge: number, httpOnly: boolean) {
  const path = name === csrfCookieName ? '/' : '/api/v1';
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; SameSite=Lax${configuration.secureCookies ? '; Secure' : ''}${httpOnly ? '; HttpOnly' : ''}`;
}

function appendCookie(response: ServerResponse, value: string) {
  const current = response.getHeader('Set-Cookie');
  const values = current === undefined ? [] : Array.isArray(current) ? current.map(String) : [String(current)];
  response.setHeader('Set-Cookie', [...values, value]);
}

function jsonResponse(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(JSON.stringify(body));
}

function safeReturnPath(value: string | null) {
  if (!value || value.length > 512 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const parsed = new URL(value, 'https://dashboard.invalid');
    return parsed.origin === 'https://dashboard.invalid' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/';
  } catch {
    return '/';
  }
}

function validDiscordSnowflake(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17,20}$/.test(value);
}

export class DiscordOAuthService implements ApiAuthentication, OAuthRouteHandlers {
  constructor(
    private readonly configuration: DiscordOAuthConfiguration,
    private readonly repository: OAuthSessionRepository,
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  async start(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url ?? '/', this.configuration.publicOrigin);
    const state = randomBytes(32).toString('base64url');
    await this.repository.createState(sha256(state), safeReturnPath(requestUrl.searchParams.get('returnTo')), this.clock() + stateLifetimeMs);
    appendCookie(response, cookie(stateCookieName, state, this.configuration, Math.floor(stateLifetimeMs / 1000), true));
    const authorizeUrl = new URL(`${discordApi}/oauth2/authorize`);
    authorizeUrl.search = new URLSearchParams({
      client_id: this.configuration.clientId,
      redirect_uri: this.configuration.redirectUri,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    }).toString();
    response.writeHead(302, { Location: authorizeUrl.toString(), 'Cache-Control': 'no-store' });
    response.end();
  }

  async callback(request: IncomingMessage, response: ServerResponse) {
    const requestUrl = new URL(request.url ?? '/', this.configuration.publicOrigin);
    const state = requestUrl.searchParams.get('state') ?? '';
    const stateCookie = cookies(request).get(stateCookieName) ?? '';
    const code = requestUrl.searchParams.get('code') ?? '';
    if (!state || !code || !equalSecret(state, stateCookie)) {
      this.clearStateCookie(response);
      jsonResponse(response, 400, { error: 'invalid_oauth_callback' });
      return;
    }
    const returnPath = await this.repository.consumeState(sha256(state), this.clock());
    this.clearStateCookie(response);
    if (!returnPath) {
      jsonResponse(response, 400, { error: 'oauth_state_expired_or_used' });
      return;
    }

    const tokens = await this.exchangeCode(code);
    const rawUser = await this.discordRequest<unknown>('/users/@me', tokens.access_token);
    if (!rawUser || typeof rawUser !== 'object' || Array.isArray(rawUser)) {
      jsonResponse(response, 502, { error: 'discord_identity_invalid' });
      return;
    }
    const user = rawUser as DiscordUser;
    if (!validDiscordSnowflake(user.id) || typeof user.username !== 'string' || user.username.length === 0) {
      jsonResponse(response, 502, { error: 'discord_identity_invalid' });
      return;
    }
    const now = this.clock();
    const sessionToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const sessionHash = sha256(sessionToken);
    await this.repository.createSession({
      sessionHash,
      csrfHash: sha256(csrfToken),
      discordUserId: user.id,
      username: user.username.slice(0, 100),
      ...(typeof user.global_name === 'string' ? { globalName: user.global_name.slice(0, 100) } : {}),
      ...(typeof user.avatar === 'string' ? { avatarHash: user.avatar } : {}),
      accessTokenCiphertext: encryptToken(tokens.access_token, this.configuration),
      ...(tokens.refresh_token ? { refreshTokenCiphertext: encryptToken(tokens.refresh_token, this.configuration) } : {}),
      encryptionKeyId: this.configuration.encryptionKeyId,
      tokenExpiresAt: now + tokens.expires_in * 1000,
      expiresAt: now + sessionLifetimeMs,
    });
    appendCookie(response, cookie(sessionCookieName, sessionToken, this.configuration, Math.floor(sessionLifetimeMs / 1000), true));
    appendCookie(response, cookie(csrfCookieName, csrfToken, this.configuration, Math.floor(sessionLifetimeMs / 1000), false));
    response.writeHead(302, {
      Location: new URL(safeReturnPath(returnPath), this.configuration.publicOrigin).toString(),
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    });
    response.end();
  }

  async logout(request: IncomingMessage, response: ServerResponse) {
    const sessionToken = cookies(request).get(sessionCookieName);
    if (sessionToken) await this.repository.revokeSession(sha256(sessionToken), this.clock());
    this.clearSessionCookies(response);
    jsonResponse(response, 200, { loggedOut: true });
  }

  async authenticate(request: IncomingMessage): Promise<ApiPrincipal | undefined> {
    const sessionToken = cookies(request).get(sessionCookieName);
    if (!sessionToken) return undefined;
    const session = await this.repository.getSession(sha256(sessionToken), this.clock());
    if (!session) return undefined;
    const accessToken = await this.accessTokenForSession(session);
    if (!accessToken) return undefined;
    return {
      discordUserId: session.discordUserId,
      username: session.username,
      ...(session.globalName ? { displayName: session.globalName } : {}),
      ...(session.avatarHash ? {
        avatarUrl: `https://cdn.discordapp.com/avatars/${session.discordUserId}/${encodeURIComponent(session.avatarHash)}.png?size=64`,
      } : {}),
    };
  }

  async listManagedGuilds(request: IncomingMessage, principal: ApiPrincipal): Promise<ManagedGuild[]> {
    const guilds = await this.userGuildsForRequest(request, principal);
    return guilds.filter(canManage).map((guild) => ({
      id: guild.id,
      name: guild.name,
      ...(guild.icon ? { iconUrl: `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png` } : {}),
      ...(guild.icon ? { iconHash: guild.icon } : {}),
      ...(Number.isSafeInteger(guild.approximate_member_count) && (guild.approximate_member_count ?? -1) >= 0
        ? { approximateMemberCount: guild.approximate_member_count }
        : {}),
      ...(typeof guild.permissions === 'string' ? { permissions: guild.permissions } : {}),
      ...(guild.owner === true ? { owner: true } : {}),
    }));
  }

  async canManageGuild(request: IncomingMessage, principal: ApiPrincipal, guildId: string) {
    if (!/^\d{17,20}$/.test(guildId)) return false;
    const guilds = await this.userGuildsForRequest(request, principal);
    return guilds.some((guild) => guild.id === guildId && canManage(guild));
  }

  async validateCsrf(request: IncomingMessage) {
    const origin = request.headers.origin;
    const headerToken = request.headers['x-csrf-token'];
    const values = cookies(request);
    const cookieToken = values.get(csrfCookieName) ?? '';
    const sessionToken = values.get(sessionCookieName);
    if (typeof origin !== 'string' || typeof headerToken !== 'string'
      || !equalSecret(headerToken, cookieToken) || !sessionToken) {
      return false;
    }
    try {
      if (new URL(origin).origin !== this.configuration.publicOrigin) return false;
    } catch {
      return false;
    }
    const session = await this.repository.getSession(sha256(sessionToken), this.clock());
    return Boolean(session && equalSecret(sha256(cookieToken), session.csrfHash));
  }

  private async userGuildsForRequest(request: IncomingMessage, principal: ApiPrincipal) {
    const token = await this.tokenForRequest(request, principal);
    const guilds = await this.discordRequest<unknown>('/users/@me/guilds?limit=200&with_counts=true', token);
    if (!Array.isArray(guilds)) throw new Error('Discord guild permission response is invalid.');
    return guilds as DiscordGuild[];
  }

  private async tokenForRequest(request: IncomingMessage, principal: ApiPrincipal) {
    const sessionToken = cookies(request).get(sessionCookieName);
    if (!sessionToken) throw new Error('OAuth session is missing.');
    const session = await this.repository.getSession(sha256(sessionToken), this.clock());
    if (!session || session.discordUserId !== principal.discordUserId) throw new Error('OAuth session is no longer valid.');
    const token = await this.accessTokenForSession(session);
    if (!token) throw new Error('OAuth session is no longer valid.');
    return token;
  }

  private async accessTokenForSession(session: OAuthSessionRecord) {
    if (session.tokenExpiresAt > this.clock() + 60_000) {
      return decryptToken(session.accessTokenCiphertext, session.encryptionKeyId, this.configuration);
    }
    if (!session.refreshTokenCiphertext) {
      await this.repository.revokeSession(session.sessionHash, this.clock());
      return undefined;
    }
    const refreshToken = decryptToken(session.refreshTokenCiphertext, session.encryptionKeyId, this.configuration);
    const refreshed = await this.refreshAccessToken(refreshToken);
    await this.repository.updateTokens(
      session.sessionHash,
      encryptToken(refreshed.access_token, this.configuration),
      refreshed.refresh_token ? encryptToken(refreshed.refresh_token, this.configuration) : undefined,
      this.configuration.encryptionKeyId,
      this.clock() + refreshed.expires_in * 1000,
    );
    return refreshed.access_token;
  }

  private async exchangeCode(code: string) {
    const body = new URLSearchParams({
      client_id: this.configuration.clientId,
      client_secret: this.configuration.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.configuration.redirectUri,
    });
    return this.tokenRequest(body);
  }

  private async refreshAccessToken(refreshToken: string) {
    const body = new URLSearchParams({
      client_id: this.configuration.clientId,
      client_secret: this.configuration.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.tokenRequest(body);
  }

  private async tokenRequest(body: URLSearchParams): Promise<OAuthTokenResponse> {
    let response: Response;
    try {
      response = await this.fetcher(`${discordApi}/oauth2/token`, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch {
      throw new DiscordOAuthRequestError('Discord OAuth token exchange failed at the network boundary.');
    }
    if (!response.ok) throw new DiscordOAuthRequestError(`Discord OAuth token exchange returned HTTP ${response.status}.`);
    let token: unknown;
    try {
      token = await response.json();
    } catch {
      throw new DiscordOAuthRequestError('Discord OAuth token endpoint returned invalid JSON.');
    }
    if (!token || typeof token !== 'object') throw new DiscordOAuthRequestError('Discord OAuth token response is invalid.');
    const record = token as Partial<OAuthTokenResponse>;
    if (typeof record.access_token !== 'string' || typeof record.expires_in !== 'number'
      || !Number.isFinite(record.expires_in) || record.expires_in <= 0
      || typeof record.token_type !== 'string' || record.token_type.toLowerCase() !== 'bearer'
      || (record.refresh_token !== undefined && typeof record.refresh_token !== 'string')) {
      throw new DiscordOAuthRequestError('Discord OAuth token response is invalid.');
    }
    return record as OAuthTokenResponse;
  }

  private async discordRequest<T>(path: string, accessToken: string): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(`${discordApi}${path}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new DiscordOAuthRequestError('Discord API request failed at the network boundary.');
    }
    if (!response.ok) throw new DiscordOAuthRequestError(`Discord API request returned HTTP ${response.status}.`);
    try {
      return await response.json() as T;
    } catch {
      throw new DiscordOAuthRequestError('Discord API returned invalid JSON.');
    }
  }

  private clearStateCookie(response: ServerResponse) {
    appendCookie(response, cookie(stateCookieName, '', this.configuration, 0, true));
  }

  private clearSessionCookies(response: ServerResponse) {
    appendCookie(response, cookie(sessionCookieName, '', this.configuration, 0, true));
    appendCookie(response, cookie(csrfCookieName, '', this.configuration, 0, false));
  }
}

function canManage(guild: DiscordGuild) {
  if (!validDiscordSnowflake(guild.id) || typeof guild.name !== 'string') return false;
  if (guild.owner === true) return true;
  if (typeof guild.permissions !== 'string' || !/^\d+$/.test(guild.permissions)) return false;
  try {
    const permissions = BigInt(guild.permissions);
    return (permissions & guildManagePermission) !== 0n || (permissions & administratorPermission) !== 0n;
  } catch {
    return false;
  }
}
