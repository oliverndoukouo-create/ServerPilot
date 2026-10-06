import type { Automation } from './types.js';
import { automationRepository, type AutomationRepository } from './store.js';

export class AutomationService {
  constructor(private readonly repository: AutomationRepository) {}

  create(automation: Automation) {
    return this.repository.create(automation);
  }

  get(id: string, guildId: string) {
    return this.repository.findById(id, guildId);
  }

  listForGuild(guildId: string) {
    return this.repository.listByGuild(guildId);
  }

  async setEnabled(id: string, guildId: string, enabled: boolean) {
    const automation = await this.repository.findById(id, guildId);
    if (!automation) return undefined;
    automation.enabled = enabled;
    const saved = await this.repository.update(automation, guildId);
    return saved ? automation : undefined;
  }

  delete(id: string, guildId: string) {
    return this.repository.delete(id, guildId);
  }
}

export const automationService = new AutomationService(automationRepository);
