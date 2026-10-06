import assert from 'node:assert/strict';
import test from 'node:test';
import { AutomationService } from '../src/automation/service.js';
import { InMemoryAutomationRepository } from '../src/automation/store.js';
import type { Automation } from '../src/automation/types.js';

function automation(id: string, guildId: string): Automation {
  return {
    id,
    guildId,
    name: `Automation ${id}`,
    enabled: true,
    trigger: { type: 'MEMBER_JOIN' },
    conditions: [],
    actions: [{ type: 'SEND_MESSAGE', channelId: 'channel-1', message: 'Welcome' }],
    createdAt: 1,
  };
}

test('automation service scopes reads and mutations to the owning guild', async () => {
  const repository = new InMemoryAutomationRepository();
  const service = new AutomationService(repository);
  await service.create(automation('automation-1', 'guild-1'));

  assert.equal(await service.get('automation-1', 'guild-2'), undefined);
  assert.deepEqual(await service.listForGuild('guild-2'), []);
  assert.equal(await repository.update(automation('automation-1', 'guild-2'), 'guild-2'), false);
  assert.equal(await service.delete('automation-1', 'guild-2'), false);
  assert.equal((await service.get('automation-1', 'guild-1'))?.enabled, true);
});

test('automation repository isolates stored values and service updates only its guild row', async () => {
  const service = new AutomationService(new InMemoryAutomationRepository());
  const input = automation('automation-2', 'guild-1');
  await service.create(input);
  input.actions[0] = { type: 'SEND_DM', message: 'mutated external object' };
  await assert.rejects(service.create(automation('automation-2', 'guild-2')), /already exists/);

  assert.equal((await service.get('automation-2', 'guild-1'))?.actions[0]?.type, 'SEND_MESSAGE');
  const disabled = await service.setEnabled('automation-2', 'guild-1', false);
  assert.equal(disabled?.enabled, false);
  assert.equal(await service.setEnabled('automation-2', 'guild-2', true), undefined);
  assert.equal((await service.get('automation-2', 'guild-1'))?.enabled, false);
});
