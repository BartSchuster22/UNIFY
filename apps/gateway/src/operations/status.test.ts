import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOperations } from './status.js';
import { buildApp } from '../app.js';
import type { AuthStore } from '../auth/types.js';

let dir: string, path: string;
const cell = 'dsh2-stage5-qa1';
const report = () => ({ schema: 'alica-operations/v1', owner: 'doghouse-dsh', observedAt: Date.now()/1000,
  snapshot: { cell }, incidents: [], audit: [] });
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'dsh-ops-test-')); path = join(dir, 'status.json'); await writeFile(path, JSON.stringify(report())); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('host operations read-only boundary', () => {
  it('reads an actual bounded report', async () => { expect((await readOperations(path, cell)).stale).toBe(false); });
  it('labels an old observation stale instead of claiming current health', async () => { expect((await readOperations(path, cell, Date.now()+30000)).stale).toBe(true); });
  it('labels future timestamps stale', async () => { expect((await readOperations(path, cell, Date.now()-30000)).stale).toBe(true); });
  it('rejects another cell', async () => { await expect(readOperations(path, 'other')).rejects.toMatchObject({statusCode:503}); });
  it('rejects missing and invalid reports', async () => { await writeFile(path, '{}'); await expect(readOperations(path, cell)).rejects.toMatchObject({statusCode:503}); await rm(path); await expect(readOperations(path, cell)).rejects.toMatchObject({statusCode:503}); });
  it('rejects symlinks', async () => { const alias = join(dir, 'link'); await symlink(path, alias); await expect(readOperations(alias, cell)).rejects.toMatchObject({statusCode:503}); });
  it('rejects oversized reports without returning their contents', async () => { await writeFile(path, 'secret-sentinel'.repeat(100000)); await expect(readOperations(path, cell)).rejects.toMatchObject({message:'Host operations report unavailable or invalid'}); });
  it('enforces authentication, permission and has no privileged write route', async () => {
    let permissions: string[] = [];
    // Auth store fixture; the actual Fastify auth/permission hooks are exercised.
    const store = { ready: async () => true, touchSession: async () => {},
      findActiveSession: async () => ({ userId:'operator', username:'operator', displayName:'Operator', roles:[], permissions,
        sessionId:'fixture',csrfHash:'fixture',expiresAt:new Date(Date.now()+60000) }) } as unknown as AuthStore;
    const app=buildApp({authStore:store,authPepper:'test-only',secureCookies:false,hostOperations:{path,cell}});
    try {
      expect((await app.inject({method:'GET',url:'/api/v1/host-operations'})).statusCode).toBe(401);
      const headers={cookie:'aquiero_session=test-only-token'};
      expect((await app.inject({method:'GET',url:'/api/v1/host-operations',headers})).statusCode).toBe(403);
      permissions=['operations.read'];
      expect((await app.inject({method:'GET',url:'/api/v1/host-operations',headers})).statusCode).toBe(200);
      expect((await app.inject({method:'POST',url:'/api/v1/host-operations',headers,payload:{op:'recover',service:'hermes'}})).statusCode).toBe(404);
    } finally { await app.close(); }
  });
});
