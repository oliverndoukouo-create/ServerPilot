import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from '../db.js';

export type WelcomeConfiguration = {
  guildId: string;
  channelId?: string;
  message: string;
  enabled: boolean;
};

export interface WelcomeRepository {
  get(guildId: string): Promise<WelcomeConfiguration | undefined>;
  save(configuration: WelcomeConfiguration): Promise<WelcomeConfiguration>;
}

export class WelcomePersistenceError extends Error {
  constructor(operation: string, code?: string) {
    super(`Welcome persistence ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'WelcomePersistenceError';
  }
}

export class InMemoryWelcomeRepository implements WelcomeRepository {
  private readonly configurations = new Map<string, WelcomeConfiguration>();

  async get(guildId: string) {
    const configuration = this.configurations.get(guildId);
    return configuration ? structuredClone(configuration) : undefined;
  }

  async save(configuration: WelcomeConfiguration) {
    this.configurations.set(configuration.guildId, structuredClone(configuration));
    return structuredClone(configuration);
  }
}

export class SupabaseWelcomeRepository implements WelcomeRepository {
  constructor(private readonly client: SupabaseClient) {}

  async get(guildId: string) {
    const { data, error } = await this.client
      .from('welcome_configurations')
      .select('discord_guild_id, enabled, channel_id, message_template')
      .eq('discord_guild_id', guildId)
      .maybeSingle();
    if (error) throw new WelcomePersistenceError('read', error.code);
    if (!data) return undefined;
    if (typeof data.discord_guild_id !== 'string' || typeof data.enabled !== 'boolean'
      || typeof data.message_template !== 'string'
      || (data.enabled && typeof data.channel_id !== 'string')) {
      throw new Error('Stored welcome configuration is invalid.');
    }
    return {
      guildId: data.discord_guild_id,
      ...(typeof data.channel_id === 'string' ? { channelId: data.channel_id } : {}),
      message: data.message_template,
      enabled: data.enabled,
    };
  }

  async save(configuration: WelcomeConfiguration) {
    const { data, error } = await this.client
      .from('welcome_configurations')
      .upsert({
        discord_guild_id: configuration.guildId,
        enabled: configuration.enabled,
        channel_id: configuration.channelId ?? null,
        message_template: configuration.message,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'discord_guild_id' })
      .select('discord_guild_id, enabled, channel_id, message_template')
      .single();
    if (error || !data) throw new WelcomePersistenceError('save', error?.code);
    return {
      guildId: data.discord_guild_id,
      ...(typeof data.channel_id === 'string' ? { channelId: data.channel_id } : {}),
      message: data.message_template,
      enabled: data.enabled,
    };
  }
}

function createRepository(): WelcomeRepository {
  const client = getSupabaseClient();
  return client ? new SupabaseWelcomeRepository(client) : new InMemoryWelcomeRepository();
}

export class WelcomeService {
  constructor(private readonly repository: WelcomeRepository) {}

  get(guildId: string) {
    return this.repository.get(guildId);
  }

  save(configuration: WelcomeConfiguration) {
    return this.repository.save(configuration);
  }
}

export const welcomeService = new WelcomeService(createRepository());
