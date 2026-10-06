import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db.js';

export type TicketConfiguration = {
  guildId: string;
  categoryId: string;
  supportRoleId: string;
  logChannelId: string;
  panelChannelId: string;
  enabled: boolean;
};

export interface TicketConfigurationRepository {
  get(guildId: string): Promise<TicketConfiguration | undefined>;
  save(configuration: TicketConfiguration): Promise<TicketConfiguration>;
}

export class TicketPersistenceError extends Error {
  constructor(operation: string, code?: string) {
    super(`Ticket persistence ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'TicketPersistenceError';
  }
}

export class InMemoryTicketConfigurationRepository implements TicketConfigurationRepository {
  private readonly configurations = new Map<string, TicketConfiguration>();

  async get(guildId: string) {
    const configuration = this.configurations.get(guildId);
    return configuration ? structuredClone(configuration) : undefined;
  }

  async save(configuration: TicketConfiguration) {
    this.configurations.set(configuration.guildId, structuredClone(configuration));
    return structuredClone(configuration);
  }
}

export class SupabaseTicketConfigurationRepository implements TicketConfigurationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async get(guildId: string) {
    const { data, error } = await this.client.from('ticket_configurations')
      .select('discord_guild_id, category_id, support_role_id, log_channel_id, panel_channel_id, enabled')
      .eq('discord_guild_id', guildId)
      .maybeSingle();
    if (error) throw new TicketPersistenceError('read', error.code);
    if (!data) return undefined;
    return {
      guildId: data.discord_guild_id,
      categoryId: data.category_id,
      supportRoleId: data.support_role_id,
      logChannelId: data.log_channel_id,
      panelChannelId: data.panel_channel_id,
      enabled: data.enabled,
    };
  }

  async save(configuration: TicketConfiguration) {
    const { data, error } = await this.client.from('ticket_configurations')
      .upsert({
        discord_guild_id: configuration.guildId,
        category_id: configuration.categoryId,
        support_role_id: configuration.supportRoleId,
        log_channel_id: configuration.logChannelId,
        panel_channel_id: configuration.panelChannelId,
        enabled: configuration.enabled,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'discord_guild_id' })
      .select('discord_guild_id, category_id, support_role_id, log_channel_id, panel_channel_id, enabled')
      .single();
    if (error || !data) throw new TicketPersistenceError('save', error?.code);
    return {
      guildId: data.discord_guild_id,
      categoryId: data.category_id,
      supportRoleId: data.support_role_id,
      logChannelId: data.log_channel_id,
      panelChannelId: data.panel_channel_id,
      enabled: data.enabled,
    };
  }
}

function createRepository(): TicketConfigurationRepository {
  const client = getSupabaseClient();
  return client ? new SupabaseTicketConfigurationRepository(client) : new InMemoryTicketConfigurationRepository();
}

export class TicketConfigurationService {
  constructor(private readonly repository: TicketConfigurationRepository) {}

  get(guildId: string) {
    return this.repository.get(guildId);
  }

  save(configuration: TicketConfiguration) {
    return this.repository.save(configuration);
  }
}

export const ticketConfigurationService = new TicketConfigurationService(createRepository());
