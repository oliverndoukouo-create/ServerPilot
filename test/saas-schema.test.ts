import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { readSupabaseConfiguration } from '../src/db.js';

test('Supabase configuration is optional until a persistence adapter requests it', () => {
  assert.equal(readSupabaseConfiguration({}), undefined);
  assert.throws(
    () => readSupabaseConfiguration({ SUPABASE_URL: 'https://example.supabase.co' }),
    /requires both SUPABASE_URL and SUPABASE_SECRET_KEY/,
  );
  assert.throws(
    () => readSupabaseConfiguration({ SUPABASE_URL: 'http://example.com', SUPABASE_SECRET_KEY: 'not-logged' }),
    /valid HTTPS URL/,
  );
  assert.deepEqual(
    readSupabaseConfiguration({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEY: 'server-only' }),
    { url: 'https://example.supabase.co', serviceKey: 'server-only' },
  );
});

test('SaaS migration defines guild-scoped data, server-only access, and atomic idempotent XP', async () => {
  const migration = await readFile(new URL('../supabase/migrations/0001_saas_foundation.sql', import.meta.url), 'utf8');
  for (const table of [
    'app_users',
    'oauth_sessions',
    'guilds',
    'guild_memberships',
    'guild_configurations',
    'automation_definitions',
    'tickets',
    'moderation_cases',
    'welcome_configurations',
    'xp_configurations',
    'member_xp',
    'analytics_events',
    'guild_analytics_daily',
    'audit_logs',
    'subscriptions',
    'stripe_webhook_events',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i'));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(migration, /revoke all on table[\s\S]+from public, anon, authenticated/i);
  assert.match(migration, /create or replace function public\.award_message_xp/);
  assert.match(migration, /on conflict do nothing/);
  assert.match(migration, /for update/);
  assert.match(migration, /p_cooldown_seconds/);
  assert.match(migration, /p_daily_xp_cap/);
});

test('ticket configuration migration is additive, guild-scoped, and service-role only', async () => {
  const migration = await readFile(new URL('../supabase/migrations/0002_ticket_configurations.sql', import.meta.url), 'utf8');
  assert.match(migration, /create table if not exists public\.ticket_configurations/);
  assert.match(migration, /references public\.guilds\(discord_guild_id\) on delete cascade/);
  assert.match(migration, /alter table public\.ticket_configurations enable row level security/);
  assert.match(migration, /revoke all on table public\.ticket_configurations from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.ticket_configurations to service_role/);
});
