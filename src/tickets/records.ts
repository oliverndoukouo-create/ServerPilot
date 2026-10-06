import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db.js';

export type TicketRecord = {
  id: string;
  guildId: string;
  channelId: string;
  creatorId: string;
  status: 'open' | 'closed' | 'deleted';
  openedAt: string;
  closedAt?: string;
  closedBy?: string;
};

export interface TicketRepository {
  open(guildId: string, channelId: string, creatorId: string): Promise<TicketRecord>;
  findOpenByCreator(guildId: string, creatorId: string): Promise<TicketRecord | undefined>;
  findOpenByChannel(guildId: string, channelId: string): Promise<TicketRecord | undefined>;
  close(guildId: string, channelId: string, closedBy: string): Promise<boolean>;
  markDeleted(guildId: string, channelId: string): Promise<boolean>;
  listForGuild(guildId: string, limit: number): Promise<TicketRecord[]>;
  countOpenForGuild(guildId: string): Promise<number>;
}

export class TicketRecordPersistenceError extends Error {
  constructor(operation: string, code?: string) {
    super(`Ticket record persistence ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'TicketRecordPersistenceError';
  }
}

export class InMemoryTicketRepository implements TicketRepository {
  private readonly records = new Map<string, TicketRecord>();

  async open(guildId: string, channelId: string, creatorId: string) {
    if ([...this.records.values()].some((record) => record.guildId === guildId && record.creatorId === creatorId && record.status === 'open')) {
      throw new TicketRecordPersistenceError('open ticket', 'duplicate_open_ticket');
    }
    const record = {
      id: `${guildId}:${channelId}`,
      guildId,
      channelId,
      creatorId,
      status: 'open' as const,
      openedAt: new Date().toISOString(),
    };
    this.records.set(record.id, record);
    return structuredClone(record);
  }

  async findOpenByCreator(guildId: string, creatorId: string) {
    const record = [...this.records.values()].find((entry) =>
      entry.guildId === guildId && entry.creatorId === creatorId && entry.status === 'open',
    );
    return record ? structuredClone(record) : undefined;
  }

  async findOpenByChannel(guildId: string, channelId: string) {
    const record = this.records.get(`${guildId}:${channelId}`);
    return record?.status === 'open' ? structuredClone(record) : undefined;
  }

  async close(guildId: string, channelId: string, closedBy: string) {
    const record = this.records.get(`${guildId}:${channelId}`);
    if (!record || record.status !== 'open') return false;
    this.records.set(record.id, { ...record, status: 'closed', closedAt: new Date().toISOString(), closedBy });
    return true;
  }

  async markDeleted(guildId: string, channelId: string) {
    const record = this.records.get(`${guildId}:${channelId}`);
    if (!record || record.status === 'deleted') return false;
    this.records.set(record.id, { ...record, status: 'deleted', closedAt: record.closedAt ?? new Date().toISOString() });
    return true;
  }

  async listForGuild(guildId: string, limit: number) {
    return [...this.records.values()]
      .filter((record) => record.guildId === guildId)
      .sort((left, right) => right.openedAt.localeCompare(left.openedAt))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async countOpenForGuild(guildId: string) {
    return [...this.records.values()].filter((record) => record.guildId === guildId && record.status === 'open').length;
  }
}

type TicketRow = {
  id: string;
  discord_guild_id: string;
  discord_channel_id: string | null;
  creator_discord_user_id: string;
  closed_by_discord_user_id: string | null;
  status: 'open' | 'closed' | 'deleted';
  opened_at: string;
  closed_at: string | null;
};

function fromRow(row: TicketRow): TicketRecord {
  if (!row.discord_channel_id) throw new Error('Stored ticket has no Discord channel.');
  return {
    id: row.id,
    guildId: row.discord_guild_id,
    channelId: row.discord_channel_id,
    creatorId: row.creator_discord_user_id,
    status: row.status,
    openedAt: row.opened_at,
    ...(row.closed_at ? { closedAt: row.closed_at } : {}),
    ...(row.closed_by_discord_user_id ? { closedBy: row.closed_by_discord_user_id } : {}),
  };
}

const ticketColumns = 'id, discord_guild_id, discord_channel_id, creator_discord_user_id, closed_by_discord_user_id, status, opened_at, closed_at';

export class SupabaseTicketRepository implements TicketRepository {
  constructor(private readonly client: SupabaseClient) {}

  async open(guildId: string, channelId: string, creatorId: string) {
    const { data, error } = await this.client.from('tickets')
      .insert({
        discord_guild_id: guildId,
        discord_channel_id: channelId,
        creator_discord_user_id: creatorId,
        status: 'open',
      })
      .select(ticketColumns)
      .single();
    if (error || !data) throw new TicketRecordPersistenceError('open ticket', error?.code);
    return fromRow(data as TicketRow);
  }

  async findOpenByCreator(guildId: string, creatorId: string) {
    const { data, error } = await this.client.from('tickets')
      .select(ticketColumns)
      .eq('discord_guild_id', guildId)
      .eq('creator_discord_user_id', creatorId)
      .eq('status', 'open')
      .maybeSingle();
    if (error) throw new TicketRecordPersistenceError('find member ticket', error.code);
    return data ? fromRow(data as TicketRow) : undefined;
  }

  async findOpenByChannel(guildId: string, channelId: string) {
    const { data, error } = await this.client.from('tickets')
      .select(ticketColumns)
      .eq('discord_guild_id', guildId)
      .eq('discord_channel_id', channelId)
      .eq('status', 'open')
      .maybeSingle();
    if (error) throw new TicketRecordPersistenceError('find channel ticket', error.code);
    return data ? fromRow(data as TicketRow) : undefined;
  }

  async close(guildId: string, channelId: string, closedBy: string) {
    const { data, error } = await this.client.from('tickets')
      .update({ status: 'closed', closed_by_discord_user_id: closedBy, closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('discord_guild_id', guildId)
      .eq('discord_channel_id', channelId)
      .eq('status', 'open')
      .select('id')
      .maybeSingle();
    if (error) throw new TicketRecordPersistenceError('close ticket', error.code);
    return data !== null && data !== undefined;
  }

  async markDeleted(guildId: string, channelId: string) {
    const { data, error } = await this.client.from('tickets')
      .update({ status: 'deleted', updated_at: new Date().toISOString() })
      .eq('discord_guild_id', guildId)
      .eq('discord_channel_id', channelId)
      .in('status', ['open', 'closed'])
      .select('id')
      .maybeSingle();
    if (error) throw new TicketRecordPersistenceError('mark missing ticket deleted', error.code);
    return data !== null && data !== undefined;
  }

  async listForGuild(guildId: string, limit: number) {
    const { data, error } = await this.client.from('tickets')
      .select(ticketColumns)
      .eq('discord_guild_id', guildId)
      .order('opened_at', { ascending: false })
      .limit(limit);
    if (error) throw new TicketRecordPersistenceError('list tickets', error.code);
    return (data ?? []).map((row) => fromRow(row as TicketRow));
  }

  async countOpenForGuild(guildId: string) {
    const { count, error } = await this.client.from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('discord_guild_id', guildId)
      .eq('status', 'open');
    if (error) throw new TicketRecordPersistenceError('count open tickets', error.code);
    return count ?? 0;
  }
}

function createRepository(): TicketRepository {
  const client = getSupabaseClient();
  return client ? new SupabaseTicketRepository(client) : new InMemoryTicketRepository();
}

export class TicketService {
  constructor(private readonly repository: TicketRepository) {}

  open(guildId: string, channelId: string, creatorId: string) {
    return this.repository.open(guildId, channelId, creatorId);
  }

  findOpenByCreator(guildId: string, creatorId: string) {
    return this.repository.findOpenByCreator(guildId, creatorId);
  }

  findOpenByChannel(guildId: string, channelId: string) {
    return this.repository.findOpenByChannel(guildId, channelId);
  }

  close(guildId: string, channelId: string, closedBy: string) {
    return this.repository.close(guildId, channelId, closedBy);
  }

  markDeleted(guildId: string, channelId: string) {
    return this.repository.markDeleted(guildId, channelId);
  }

  listForGuild(guildId: string, limit = 50) {
    return this.repository.listForGuild(guildId, Math.min(Math.max(limit, 1), 100));
  }

  countOpenForGuild(guildId: string) {
    return this.repository.countOpenForGuild(guildId);
  }
}

export const ticketService = new TicketService(createRepository());
