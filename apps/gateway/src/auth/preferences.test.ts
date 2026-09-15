import { it, expect } from 'vitest';
import { AuthService } from './service.js';
import type { AuthStore } from './types.js';
it('persists a validated preference independently for each account', async () => {
  const values = new Map<string, string>();
  const store = {
    getTimezone: async (id: string) => values.get(id) ?? null,
    setTimezone: async (id: string, tz: string) => {
      values.set(id, tz);
    },
  } as AuthStore;
  const service = new AuthService({ store, pepper: 'test' });
  expect(await service.preferences('a')).toEqual({ timezone: null });
  await service.setTimezone('a', 'Atlantic/Canary');
  expect(await service.preferences('a')).toEqual({ timezone: 'Atlantic/Canary' });
  expect(await service.preferences('b')).toEqual({ timezone: null });
  for (const zone of ['', 'invalid/zone', '+01:00'])
    await expect(service.setTimezone('a', zone)).rejects.toMatchObject({
      code: 'INVALID_TIMEZONE',
    });
  expect(await service.preferences('a')).toEqual({ timezone: 'Atlantic/Canary' });
  await service.setTimezone('a', 'UTC');
  expect(await service.preferences('a')).toEqual({ timezone: 'UTC' });
});
