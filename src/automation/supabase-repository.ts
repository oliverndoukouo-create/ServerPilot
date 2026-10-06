import type { SupabaseClient } from '@supabase/supabase-js';
import type { Automation } from './types.js';
import type { AutomationRepository } from './store.js';

type AutomationRow = {
  id: string;
  discord_guild_id: string;
  name: string;
  enabled: boolean;
  schema_version: number;
  definition: {
    trigger: Automation['trigger'];
    conditions: Automation['conditions'];
    actions: Automation['actions'];
    createdAt: number;
  };
};

export class AutomationPersistenceError extends Error {
  constructor(operation: string, code?: string) {
    super(`Automation persistence ${operation} failed${code ? ` (${code})` : ''}.`);
    this.name = 'AutomationPersistenceError';
  }
}

function fromRow(row: AutomationRow): Automation {
  if (row.schema_version !== 1
    || !row.definition
    || !Array.isArray(row.definition.conditions)
    || !Array.isArray(row.definition.actions)
    || typeof row.definition.createdAt !== 'number'
    || !row.definition.trigger
    || typeof row.definition.trigger.type !== 'string') {
    throw new Error('Stored automation has an unsupported or invalid schema.');
  }
  return {
    id: row.id,
    guildId: row.discord_guild_id,
    name: row.name,
    enabled: row.enabled,
    trigger: row.definition.trigger,
    conditions: row.definition.conditions,
    actions: row.definition.actions,
    createdAt: row.definition.createdAt,
  };
}

function toRow(automation: Automation): Omit<AutomationRow, 'schema_version'> & { schema_version: 1 } {
  return {
    id: automation.id,
    discord_guild_id: automation.guildId,
    name: automation.name,
    enabled: automation.enabled,
    schema_version: 1,
    definition: {
      trigger: automation.trigger,
      conditions: automation.conditions,
      actions: automation.actions,
      createdAt: automation.createdAt,
    },
  };
}

export class SupabaseAutomationRepository implements AutomationRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(automation: Automation) {
    const { data, error } = await this.client
      .from('automation_definitions')
      .insert(toRow(automation))
      .select('id, discord_guild_id, name, enabled, schema_version, definition')
      .single();
    if (error || !data) throw new AutomationPersistenceError('create', error?.code);
    return fromRow(data as AutomationRow);
  }

  async findById(id: string, guildId: string) {
    const { data, error } = await this.client
      .from('automation_definitions')
      .select('id, discord_guild_id, name, enabled, schema_version, definition')
      .eq('id', id)
      .eq('discord_guild_id', guildId)
      .maybeSingle();
    if (error) throw new AutomationPersistenceError('read', error.code);
    return data ? fromRow(data as AutomationRow) : undefined;
  }

  async listByGuild(guildId: string) {
    const { data, error } = await this.client
      .from('automation_definitions')
      .select('id, discord_guild_id, name, enabled, schema_version, definition')
      .eq('discord_guild_id', guildId)
      .order('created_at', { ascending: true });
    if (error) throw new AutomationPersistenceError('list', error.code);
    return (data ?? []).map((row) => fromRow(row as AutomationRow));
  }

  async update(automation: Automation, guildId: string) {
    const { data, error } = await this.client
      .from('automation_definitions')
      .update({
        name: automation.name,
        enabled: automation.enabled,
        definition: toRow(automation).definition,
        updated_at: new Date().toISOString(),
      })
      .eq('id', automation.id)
      .eq('discord_guild_id', guildId)
      .select('id')
      .maybeSingle();
    if (error) throw new AutomationPersistenceError('update', error.code);
    return data !== null && data !== undefined;
  }

  async delete(id: string, guildId: string) {
    const { data, error } = await this.client
      .from('automation_definitions')
      .delete()
      .eq('id', id)
      .eq('discord_guild_id', guildId)
      .select('id')
      .maybeSingle();
    if (error) throw new AutomationPersistenceError('delete', error.code);
    return data !== null && data !== undefined;
  }
}
