import type { Automation } from './types.js';
import { getSupabaseClient } from '../db.js';
import { SupabaseAutomationRepository } from './supabase-repository.js';

export interface AutomationRepository {
  create(automation: Automation): Promise<Automation>;
  findById(id: string, guildId: string): Promise<Automation | undefined>;
  listByGuild(guildId: string): Promise<Automation[]>;
  update(automation: Automation, guildId: string): Promise<boolean>;
  delete(id: string, guildId: string): Promise<boolean>;
}

export class InMemoryAutomationRepository implements AutomationRepository {
  private readonly automations = new Map<string, Automation>();

  async create(automation: Automation) {
    const stored = structuredClone(automation);
    if (this.automations.has(stored.id)) throw new Error('An automation with this ID already exists.');
    this.automations.set(stored.id, stored);
    return structuredClone(stored);
  }

  async findById(id: string, guildId: string) {
    const automation = this.automations.get(id);
    return automation?.guildId === guildId ? structuredClone(automation) : undefined;
  }

  async listByGuild(guildId: string) {
    return [...this.automations.values()]
      .filter((automation) => automation.guildId === guildId)
      .map((automation) => structuredClone(automation));
  }

  async update(automation: Automation, guildId: string) {
    const existing = this.automations.get(automation.id);
    if (!existing || existing.guildId !== guildId || automation.guildId !== guildId) return false;
    this.automations.set(automation.id, structuredClone(automation));
    return true;
  }

  async delete(id: string, guildId: string) {
    const automation = this.automations.get(id);
    return automation?.guildId === guildId ? this.automations.delete(id) : false;
  }
}

export function createAutomationRepository(): AutomationRepository {
  const client = getSupabaseClient();
  return client ? new SupabaseAutomationRepository(client) : new InMemoryAutomationRepository();
}

export const automationRepository: AutomationRepository = createAutomationRepository();
