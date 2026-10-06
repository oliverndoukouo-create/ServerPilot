import type { SupabaseClient } from '@supabase/supabase-js';
import type { ManagedGuild } from '../api/server.js';

export type GuildSnapshot = {
  id: string;
  name: string;
  iconHash?: string;
  ownerUserId?: string;
};

export interface GuildRepository {
  syncGuilds(guilds: GuildSnapshot[]): Promise<void>;
  ensureGuilds(guilds: GuildSnapshot[]): Promise<void>;
  syncManagedMemberships(userId: string, guilds: ManagedGuild[]): Promise<void>;
}

export class GuildPersistenceError extends Error {
  constructor(operation: string, code?: string) {
    super(`Guild persistence ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'GuildPersistenceError';
  }
}

export class SupabaseGuildRepository implements GuildRepository {
  constructor(private readonly client: SupabaseClient) {}

  async syncGuilds(guilds: GuildSnapshot[]) {
    if (guilds.length === 0) return;
    const records = guilds.map((guild) => ({
      discord_guild_id: guild.id,
      name: guild.name,
      icon_hash: guild.iconHash ?? null,
      owner_discord_user_id: guild.ownerUserId ?? null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    const { error } = await this.client.from('guilds').upsert(records, {
      onConflict: 'discord_guild_id',
      ignoreDuplicates: false,
    });
    if (error) throw new GuildPersistenceError('sync guilds', error.code);
  }

  async ensureGuilds(guilds: GuildSnapshot[]) {
    if (guilds.length === 0) return;
    const records = guilds.map((guild) => ({
      discord_guild_id: guild.id,
      name: guild.name,
      icon_hash: guild.iconHash ?? null,
      ...(guild.ownerUserId ? { owner_discord_user_id: guild.ownerUserId } : {}),
    }));
    const { error } = await this.client.from('guilds').upsert(records, {
      onConflict: 'discord_guild_id',
      ignoreDuplicates: true,
    });
    if (error) throw new GuildPersistenceError('ensure guilds', error.code);
  }

  async syncManagedMemberships(userId: string, guilds: ManagedGuild[]) {
    if (guilds.length === 0) return;
    const { error } = await this.client.from('guild_memberships').upsert(guilds.map((guild) => ({
      discord_guild_id: guild.id,
      discord_user_id: userId,
      permissions: guild.permissions ?? '0',
      is_owner: guild.owner === true,
      verified_at: new Date().toISOString(),
    })), { onConflict: 'discord_guild_id,discord_user_id' });
    if (error) throw new GuildPersistenceError('sync managed memberships', error.code);
  }
}

export class InMemoryGuildRepository implements GuildRepository {
  readonly guilds = new Map<string, GuildSnapshot>();
  readonly memberships = new Map<string, { userId: string; guildId: string; permissions: string; owner: boolean }>();

  async syncGuilds(guilds: GuildSnapshot[]) {
    for (const guild of guilds) this.guilds.set(guild.id, structuredClone(guild));
  }

  async ensureGuilds(guilds: GuildSnapshot[]) {
    for (const guild of guilds) {
      if (!this.guilds.has(guild.id)) this.guilds.set(guild.id, structuredClone(guild));
    }
  }

  async syncManagedMemberships(userId: string, guilds: ManagedGuild[]) {
    for (const guild of guilds) {
      this.memberships.set(`${guild.id}:${userId}`, {
        userId,
        guildId: guild.id,
        permissions: guild.permissions ?? '0',
        owner: guild.owner === true,
      });
    }
  }
}
