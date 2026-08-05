import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const applications: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

describe('standalone runtime boundary', () => {
  for (const path of [
    '/api/v1/integrations',
    '/api/v1/resources',
    '/api/v1/search',
    '/api/v1/events',
    '/api/v1/shadow',
  ]) {
    it(`does not expose retired route ${path}`, async () => {
      const app = buildApp({ authStore: {} as never, authPepper: 'x'.repeat(32) });
      applications.push(app);
      const response = await app.inject({ method: 'GET', url: path });
      expect(response.statusCode).toBe(404);
    });
  }
});
