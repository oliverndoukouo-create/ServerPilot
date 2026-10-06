import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db.js';

export type ModerationAction = 'warn' | 'timeout' | 'kick' | 'ban';

export type ModerationCase = {
  id: string;
  guildId: string;
  targetUserId: string;
  moderatorUserId: string;
  action: ModerationAction;
  reason: string;
  durationSeconds?: number;
  createdAt: string;
};

export interface ModerationRepository {
  record(entry: Omit<ModerationCase, 'id' | 'createdAt'>): Promise<ModerationCase>;
  listForGuild(guildId: string, limit: number): Promise<ModerationCase[]>;
}

export class ModerationPersistenceError extends Error {
  constructor(operation: string, code?: string) {
    super(`Moderation persistence ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'ModerationPersistenceError';
  }
}

export class InMemoryModerationRepository implements ModerationRepository {
  private readonly cases: ModerationCase[] = [];

  async record(entry: Omit<ModerationCase, 'id' | 'createdAt'>) {
    const result: ModerationCase = { ...structuredClone(entry), id: `mem_${this.cases.length + 1}`, createdAt: new Date().toISOString() };
    this.cases.unshift(result);
    return structuredClone(result);
  }

  async listForGuild(guildId: string, limit: number) {
    return this.cases.filter((entry) => entry.guildId === guildId).slice(0, limit).map((entry) => structuredClone(entry));
  }
}

type ModerationCaseRow = {
  id: string;
  discord_guild_id: string;
  target_discord_user_id: string;
  moderator_discord_user_id: string | null;
  action_type: ModerationAction;
  reason: string;
  duration_seconds: number | null;
  created_at: string;
};

function fromRow(row: ModerationCaseRow): ModerationCase {
  return {
    id: row.id,
    guildId: row.discord_guild_id,
    targetUserId: row.target_discord_user_id,
    moderatorUserId: row.moderator_discord_user_id ?? '',
    action: row.action_type,
    reason: row.reason,
    ...(row.duration_seconds === null ? {} : { durationSeconds: row.duration_seconds }),
    createdAt: row.created_at,
  };
}

export class SupabaseModerationRepository implements ModerationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async record(entry: Omit<ModerationCase, 'id' | 'createdAt'>) {
    const { data, error } = await this.client.from('moderation_cases')
      .insert({
        discord_guild_id: entry.guildId,
        target_discord_user_id: entry.targetUserId,
        moderator_discord_user_id: entry.moderatorUserId,
        action_type: entry.action,
        reason: entry.reason,
        duration_seconds: entry.durationSeconds ?? null,
      })
      .select('id, discord_guild_id, target_discord_user_id, moderator_discord_user_id, action_type, reason, duration_seconds, created_at')
      .single();
    if (error || !data) throw new ModerationPersistenceError('record case', error?.code);
    return fromRow(data as ModerationCaseRow);
  }

  async listForGuild(guildId: string, limit: number) {
    const { data, error } = await this.client.from('moderation_cases')
      .select('id, discord_guild_id, target_discord_user_id, moderator_discord_user_id, action_type, reason, duration_seconds, created_at')
      .eq('discord_guild_id', guildId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new ModerationPersistenceError('list cases', error.code);
    return (data ?? []).map((row) => fromRow(row as ModerationCaseRow));
  }
}

function createRepository(): ModerationRepository {
  const client = getSupabaseClient();
  return client ? new SupabaseModerationRepository(client) : new InMemoryModerationRepository();
}

export class ModerationService {
  constructor(private readonly repository: ModerationRepository) {}

  record(entry: Omit<ModerationCase, 'id' | 'createdAt'>) {
    return this.repository.record(entry);
  }

  listForGuild(guildId: string, limit = 50) {
    return this.repository.listForGuild(guildId, Math.min(Math.max(limit, 1), 100));
  }
}

export const moderationService = new ModerationService(createRepository());
