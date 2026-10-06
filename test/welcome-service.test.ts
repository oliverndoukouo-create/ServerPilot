import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryWelcomeRepository, WelcomeService } from '../src/welcome/store.js';

test('welcome service reads and updates isolated guild configurations', async () => {
  const service = new WelcomeService(new InMemoryWelcomeRepository());
  const configuration = {
    guildId: '23456789012345678',
    channelId: '23456789012345679',
    message: 'Welcome {user}',
    enabled: true,
  };
  await service.save(configuration);
  configuration.message = 'changed after save';

  assert.deepEqual(await service.get('23456789012345678'), {
    guildId: '23456789012345678',
    channelId: '23456789012345679',
    message: 'Welcome {user}',
    enabled: true,
  });
  assert.equal(await service.get('23456789012345670'), undefined);
});
