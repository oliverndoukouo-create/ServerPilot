import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import { createApiServer } from '../src/api/server.js';
import {
  DiscordOAuthService,
  readDiscordOAuthConfiguration,
  type OAuthSessionRecord,
  type OAuthSessionRepository,
} from '../src/api/oauth.js';

const userId = '12345678901234567';
const key = Buffer.alloc(32, 7).toString('base64');
const configuration = readDiscordOAuthConfiguration({
  DISCORD_OAUTH_CLIENT_ID: 'client-id',
  DISCORD_OAUTH_CLIENT_SECRET: 'client-secret',
  DISCORD_OAUTH_REDIRECT_URI: 'http://localhost:3001/api/v1/auth/discord/callback',
  DASHBOARD_PUBLIC_ORIGIN: 'http://localhost:3001',
  DASHBOARD_TOKEN_ENCRYPTION_KEY: key,
});
assert.ok(configuration);

class MemoryOAuthRepository implements OAuthSessionRepository {
  readonly states = new Map<string, { returnPath: string; expiresAt: number; consumed: boolean }>();
  readonly sessions = new Map<string, OAuthSessionRecord>();
  readonly revoked = new Set<string>();

  async createState(stateHash: string, returnPath: string, expiresAt: number) {
    this.states.set(stateHash, { returnPath, expiresAt, consumed: false });
  }

  async consumeState(stateHash: string, now: number) {
    const state = this.states.get(stateHash);
    if (!state || state.consumed || state.expiresAt <= now) return undefined;
    state.consumed = true;
    return state.returnPath;
  }

  async createSession(session: OAuthSessionRecord) {
    this.sessions.set(session.sessionHash, structuredClone(session));
  }

  async getSession(sessionHash: string, now: number) {
    const session = this.sessions.get(sessionHash);
    return !session || this.revoked.has(sessionHash) || session.expiresAt <= now
      ? undefined
      : structuredClone(session);
  }

  async updateTokens(sessionHash: string, accessTokenCiphertext: string, refreshTokenCiphertext: string | undefined, encryptionKeyId: string, tokenExpiresAt: number) {
    const session = this.sessions.get(sessionHash);
    if (!session) throw new Error('No session.');
    session.accessTokenCiphertext = accessTokenCiphertext;
    session.refreshTokenCiphertext = refreshTokenCiphertext;
    session.encryptionKeyId = encryptionKeyId;
    session.tokenExpiresAt = tokenExpiresAt;
  }

  async revokeSession(sessionHash: string) {
    this.revoked.add(sessionHash);
  }
}

async function withServer(service: DiscordOAuthService, action: (url: string) => Promise<void>) {
  const server = createApiServer({
    authentication: service,
    oauth: service,
    databaseStatus: 'configured_not_verified',
    discordOAuthStatus: 'configured_not_verified',
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

test('OAuth config fails closed on partial setup and rejects non-HTTPS public origins', () => {
  assert.equal(readDiscordOAuthConfiguration({}), undefined);
  assert.throws(
    () => readDiscordOAuthConfiguration({ DISCORD_OAUTH_CLIENT_ID: 'id' }),
    /requires client ID, client secret/,
  );
  assert.throws(
    () => readDiscordOAuthConfiguration({
      DISCORD_OAUTH_CLIENT_ID: 'id',
      DISCORD_OAUTH_CLIENT_SECRET: 'secret',
      DISCORD_OAUTH_REDIRECT_URI: 'http://example.com/callback',
      DASHBOARD_PUBLIC_ORIGIN: 'http://example.com',
      DASHBOARD_TOKEN_ENCRYPTION_KEY: key,
    }),
    /must use HTTPS outside localhost/,
  );
});

test('Discord OAuth binds one-use state to a browser cookie, encrypts tokens, and checks guild permissions live', async () => {
  const repository = new MemoryOAuthRepository();
  let requestToken = '';
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth2/token')) {
      return Response.json({
        access_token: 'raw-provider-access-token',
        refresh_token: 'raw-provider-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
      });
    }
    requestToken = new Headers(init?.headers).get('authorization') ?? '';
    if (url.endsWith('/users/@me')) {
      return Response.json({ id: userId, username: 'operator', global_name: 'Server Operator', avatar: 'avatar_hash' });
    }
    if (url.includes('/users/@me/guilds')) {
      return Response.json([
        { id: '23456789012345678', name: 'Manager', permissions: '32' },
        { id: '23456789012345679', name: 'Administrator', permissions: '8' },
        { id: '23456789012345670', name: 'Owner', owner: true, permissions: '0' },
        { id: '23456789012345671', name: 'Member', permissions: '1024' },
      ]);
    }
    return new Response(null, { status: 404 });
  };
  const service = new DiscordOAuthService(configuration, repository, fetcher, () => 1_800_000_000_000);

  await withServer(service, async (baseUrl) => {
    const start = await fetch(`${baseUrl}/api/v1/auth/discord?returnTo=%2Fsettings%3Ftab%3Dgeneral`, {
      redirect: 'manual',
    });
    assert.equal(start.status, 302);
    const authorization = new URL(start.headers.get('location')!);
    assert.equal(authorization.searchParams.get('scope'), 'identify guilds');
    assert.equal(authorization.searchParams.get('client_id'), 'client-id');
    const state = authorization.searchParams.get('state')!;
    const stateCookie = start.headers.getSetCookie().find((value) => value.startsWith('sp_oauth_state='))!.split(';', 1)[0]!;
    assert.equal(repository.states.get(createHash('sha256').update(state).digest('hex'))?.returnPath, '/settings?tab=general');

    const callback = await fetch(`${baseUrl}/api/v1/auth/discord/callback?code=single-use-code&state=${state}`, {
      headers: { cookie: stateCookie },
      redirect: 'manual',
    });
    assert.equal(callback.status, 302);
    assert.equal(new URL(callback.headers.get('location')!).pathname, '/settings');
    assert.equal(new URL(callback.headers.get('location')!).search, '?tab=general');
    const setCookies = callback.headers.getSetCookie();
    const sessionCookie = setCookies.find((value) => value.startsWith('sp_session='))!.split(';', 1)[0]!;
    const csrfCookie = setCookies.find((value) => value.startsWith('sp_csrf='))!.split(';', 1)[0]!;
    assert.match(setCookies.find((value) => value.startsWith('sp_csrf='))!, /Path=\//);
    assert.doesNotMatch(setCookies.find((value) => value.startsWith('sp_csrf='))!, /HttpOnly/);
    const session = [...repository.sessions.values()][0]!;
    assert.equal(session.discordUserId, userId);
    assert.equal(session.accessTokenCiphertext.includes('raw-provider-access-token'), false);
    assert.equal(session.refreshTokenCiphertext?.includes('raw-provider-refresh-token'), false);

    const me = await fetch(`${baseUrl}/api/v1/me`, { headers: { cookie: sessionCookie } });
    assert.equal(me.status, 200);
    assert.deepEqual(await me.json(), {
      user: {
        discordUserId: userId,
        username: 'operator',
        displayName: 'Server Operator',
        avatarUrl: `https://cdn.discordapp.com/avatars/${userId}/avatar_hash.png?size=64`,
      },
    });

    const guilds = await fetch(`${baseUrl}/api/v1/guilds`, { headers: { cookie: sessionCookie } });
    assert.equal(guilds.status, 200);
    assert.deepEqual((await guilds.json() as { guilds: Array<{ id: string }> }).guilds.map((guild) => guild.id), [
      '23456789012345678',
      '23456789012345679',
      '23456789012345670',
    ]);
    assert.equal(requestToken, 'Bearer raw-provider-access-token');

    const csrf = csrfCookie.split('=', 2)[1]!;
    const memberOnlyGuild = await fetch(`${baseUrl}/api/v1/guilds/23456789012345671/overview`, {
      headers: { cookie: sessionCookie },
    });
    assert.equal(memberOnlyGuild.status, 403);

    const missingCsrf = await fetch(`${baseUrl}/api/v1/guilds/23456789012345678/settings`, {
      method: 'PUT',
      headers: {
        cookie: `${sessionCookie}; ${csrfCookie}`,
        origin: configuration.publicOrigin,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(missingCsrf.status, 403);

    const badOrigin = await fetch(`${baseUrl}/api/v1/guilds/23456789012345678/settings`, {
      method: 'PUT',
      headers: {
        cookie: `${sessionCookie}; ${csrfCookie}`,
        origin: 'https://attacker.example',
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(badOrigin.status, 403);

    const notYetImplemented = await fetch(`${baseUrl}/api/v1/guilds/23456789012345678/settings`, {
      method: 'PUT',
      headers: {
        cookie: `${sessionCookie}; ${csrfCookie}`,
        origin: configuration.publicOrigin,
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    assert.equal(notYetImplemented.status, 501);

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${sessionCookie}; ${csrfCookie}`,
        origin: configuration.publicOrigin,
        'x-csrf-token': csrf,
      },
    });
    assert.equal(logout.status, 200);
    assert.deepEqual(await logout.json(), { loggedOut: true });
    assert.equal(repository.revoked.size, 1);
  });
});

test('OAuth callback rejects state not bound to the initiating browser', async () => {
  const repository = new MemoryOAuthRepository();
  let providerCalls = 0;
  const service = new DiscordOAuthService(configuration, repository, async () => {
    providerCalls += 1;
    return Response.json({});
  });
  await withServer(service, async (baseUrl) => {
    const start = await fetch(`${baseUrl}/api/v1/auth/discord`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    const callback = await fetch(`${baseUrl}/api/v1/auth/discord/callback?code=abc&state=${state}`, {
      headers: { cookie: 'sp_oauth_state=wrong-browser-state' },
    });
    assert.equal(callback.status, 400);
    assert.equal(providerCalls, 0);
  });
});
