import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryGuildRepository } from '../src/guilds/repository.js';

test('guild repository records server snapshots and user permission snapshots without aliasing input', async () => {
  const repository = new InMemoryGuildRepository();
  const guild = { id: '23456789012345678', name: 'Community', iconHash: 'hash', ownerUserId: '12345678901234567' };
  const managedGuild = {
    id: guild.id,
    name: guild.name,
    owner: true,
    permissions: '0',
  };
  await repository.syncGuilds([guild]);
  await repository.syncManagedMemberships('12345678901234567', [managedGuild]);
  guild.name = 'mutated outside repository';

  assert.equal(repository.guilds.get(guild.id)?.name, 'Community');
  assert.deepEqual(repository.memberships.get(`${guild.id}:12345678901234567`), {
    userId: '12345678901234567',
    guildId: guild.id,
    permissions: '0',
    owner: true,
  });

  test('ensuring OAuth-visible guilds does not overwrite bot-synchronized guild metadata', async () => {
    const repository = new InMemoryGuildRepository();
    await repository.syncGuilds([{
      id: '23456789012345678',
      name: 'Current Discord Name',
      iconHash: 'server-icon',
      ownerUserId: '12345678901234567',
    }]);
    await repository.ensureGuilds([{
      id: '23456789012345678',
      name: 'Possibly stale OAuth snapshot',
    }]);

    assert.deepEqual(repository.guilds.get('23456789012345678'), {
      id: '23456789012345678',
      name: 'Current Discord Name',
      iconHash: 'server-icon',
      ownerUserId: '12345678901234567',
    });
  });
});
