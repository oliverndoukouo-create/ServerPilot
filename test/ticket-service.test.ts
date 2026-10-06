import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryTicketRepository, TicketService } from '../src/tickets/records.js';
import { InMemoryTicketConfigurationRepository, TicketConfigurationService } from '../src/tickets/store.js';

test('ticket lifecycle repository is guild-scoped and persists open, close, and delete status', async () => {
  const service = new TicketService(new InMemoryTicketRepository());
  const opened = await service.open('23456789012345678', '23456789012345679', '23456789012345670');

  assert.equal((await service.findOpenByCreator(opened.guildId, opened.creatorId))?.channelId, opened.channelId);
  assert.equal((await service.findOpenByChannel('23456789012345679', opened.channelId)), undefined);
  assert.equal(await service.countOpenForGuild(opened.guildId), 1);
  assert.deepEqual(await service.listForGuild('23456789012345679'), []);

  assert.equal(await service.close(opened.guildId, opened.channelId, '23456789012345671'), true);
  assert.equal(await service.findOpenByChannel(opened.guildId, opened.channelId), undefined);
  assert.equal(await service.countOpenForGuild(opened.guildId), 0);
  const closed = (await service.listForGuild(opened.guildId))[0];
  assert.equal(closed?.closedBy, '23456789012345671');
  assert.ok(closed?.closedAt);
  assert.equal(await service.markDeleted(opened.guildId, opened.channelId), true);
  const deleted = (await service.listForGuild(opened.guildId))[0];
  assert.equal(deleted?.status, 'deleted');
  assert.equal(deleted?.closedBy, '23456789012345671');
  assert.equal(deleted?.closedAt, closed?.closedAt);
});

test('ticket configuration service persists through a guild-scoped repository boundary', async () => {
  const service = new TicketConfigurationService(new InMemoryTicketConfigurationRepository());
  const configuration = {
    guildId: '23456789012345678',
    categoryId: '23456789012345679',
    supportRoleId: '23456789012345670',
    logChannelId: '23456789012345671',
    panelChannelId: '23456789012345672',
    enabled: true,
  };
  await service.save(configuration);
  configuration.enabled = false;

  assert.equal((await service.get('23456789012345678'))?.enabled, true);
  assert.equal(await service.get('23456789012345670'), undefined);
});
