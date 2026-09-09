import { describe, it, expect } from 'vitest';
import {
  ProjectCredentialService,
  type ProjectCredentialStore,
  type ProjectGrant,
} from './project-credentials.js';
function fixture() {
  const values = new Map<string, ProjectGrant>();
  const store: ProjectCredentialStore = {
    async create(ownerId, name, frameworkId, projectId, hash, expiresAt) {
      const g = { id: 'one', ownerId, name, frameworkId, projectId, expiresAt, revokedAt: null };
      values.set(hash, g);
      return g;
    },
    async find(hash) {
      return values.get(hash) ?? null;
    },
    async list() {
      return [...values.values()];
    },
    async revoke() {
      for (const g of values.values()) g.revokedAt = new Date();
      return true;
    },
  };
  return { values, service: new ProjectCredentialService(store) };
}
describe('project-scoped service credentials', () => {
  it('returns the secret once but stores only its hash', async () => {
    const f = fixture();
    const r = await f.service.create('owner', 'reader', 'hermes-alica', 'project-one', 120);
    expect(JSON.stringify([...f.values])).not.toContain(r.token);
    expect(
      await f.service.authorize('Bearer ' + r.token, 'hermes-alica', 'project-one'),
    ).toMatchObject({ id: 'one' });
    expect(r.permission).toBe('project.read');
  });
  it('denies another project and framework before native access', async () => {
    const f = fixture();
    const r = await f.service.create('owner', 'reader', 'hermes-alica', 'project-one', 120);
    await expect(
      f.service.authorize('Bearer ' + r.token, 'hermes-alica', 'project-two'),
    ).rejects.toMatchObject({ code: 'PROJECT_SCOPE_DENIED' });
    await expect(
      f.service.authorize('Bearer ' + r.token, 'another-framework', 'project-one'),
    ).rejects.toMatchObject({ code: 'PROJECT_SCOPE_DENIED' });
  });
  it('revokes immediately and rejects expired credentials', async () => {
    const f = fixture();
    const r = await f.service.create('owner', 'reader', 'hermes-alica', 'project-one', 120);
    r.grant.expiresAt = new Date(1);
    await expect(
      f.service.authorize('Bearer ' + r.token, 'hermes-alica', 'project-one'),
    ).rejects.toMatchObject({ statusCode: 401 });
    r.grant.expiresAt = new Date(Date.now() + 60000);
    await f.service.store.revoke('one');
    await expect(
      f.service.authorize('Bearer ' + r.token, 'hermes-alica', 'project-one'),
    ).rejects.toMatchObject({ statusCode: 401 });
  });
  it.each([undefined, 'Bearer jwt-token', 'Bearer adapter-secret', 'Basic something'])(
    'does not confuse credential classes: %s',
    async (header) => {
      await expect(
        fixture().service.authorize(header, 'hermes-alica', 'project-one'),
      ).rejects.toMatchObject({ statusCode: 401 });
    },
  );
  it.each([0, 59, 86401, NaN, Infinity, 60.5])('rejects invalid lifetimes %s', async (ttl) => {
    await expect(
      fixture().service.create('o', 'n', 'hermes-alica', 'p', ttl),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
