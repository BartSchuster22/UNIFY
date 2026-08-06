import { describe, expect, it } from 'vitest';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkRegistrationInput,
} from '@aquiero/contracts';
import { FrameworkRegistryError, FrameworkRegistryService } from './service.js';
import type {
  FrameworkProbe,
  FrameworkRegistrationRecord,
  FrameworkRegistrationStore,
} from './types.js';

class MemoryStore implements FrameworkRegistrationStore {
  records = new Map<string, FrameworkRegistrationRecord>();
  async ready() {
    return true;
  }
  async list() {
    return [...this.records.values()];
  }
  async get(id: string) {
    return this.records.get(id) ?? null;
  }
  async upsert(value: FrameworkRegistrationRecord) {
    this.records.set(value.frameworkId, value);
    return value;
  }
  async remove(id: string) {
    return this.records.delete(id);
  }
}
const meta = {
  contractVersion: HERMES_CONTROL_VERSION,
  frameworkId: 'hermes-dev',
  frameworkVersion: PINNED_HERMES_RELEASE,
  frameworkCommit: PINNED_HERMES_COMMIT,
  sourceVersion: `git:${PINNED_HERMES_COMMIT}`,
  observedAt: '2026-07-21T12:00:00.000Z',
};
const probe: FrameworkProbe = {
  async inspect() {
    return {
      identity: {
        ...meta,
        data: { runtime: 'hermes-agent', instanceId: 'pinned', displayName: 'Hermes' },
      },
      version: {
        ...meta,
        data: {
          release: PINNED_HERMES_RELEASE,
          commit: PINNED_HERMES_COMMIT,
          dirty: false,
          pythonVersion: '3.11.15',
        },
      },
      capabilities: { ...meta, data: { capabilities: {} } },
    };
  },
};
const input: FrameworkRegistrationInput = {
  frameworkId: 'hermes-dev',
  displayName: 'Hermes Dev',
  baseUrl: 'http://127.0.0.1:18799',
  serviceAuthReference: 'env:HERMES_CONTROL_TOKEN',
  scopes: ['control:read', 'control:events'],
  expectedContractVersion: HERMES_CONTROL_VERSION,
  expectedFrameworkVersion: PINNED_HERMES_RELEASE,
  expectedFrameworkCommit: PINNED_HERMES_COMMIT,
  enabled: true,
};

describe('FrameworkRegistryService', () => {
  it('registers only a probed pinned Hermes and never returns the auth reference', async () => {
    const store = new MemoryStore();
    const service = new FrameworkRegistryService(store, probe, () => 'fixture-token');
    const result = await service.register(input);
    expect(result.status).toBe('verified');
    expect(result).not.toHaveProperty('serviceAuthReference');
    expect((await store.get('hermes-dev'))?.serviceAuthReference).toBe('env:HERMES_CONTROL_TOKEN');
  });

  it('reconciles an identical declaration without rewriting registration evidence', async () => {
    const store = new MemoryStore();
    const service = new FrameworkRegistryService(store, probe, () => 'fixture-token');
    const first = await service.reconcile(input);
    const stored = structuredClone(await store.get(input.frameworkId));
    const second = await service.reconcile(input);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(await store.get(input.frameworkId)).toEqual(stored);
  });

  it('fails closed when service authentication is unavailable', async () => {
    const service = new FrameworkRegistryService(new MemoryStore(), probe, () => undefined);
    await expect(service.register(input)).rejects.toMatchObject({
      code: 'SERVICE_AUTH_UNAVAILABLE',
    });
  });

  it('fails closed on an unpinned version before probing', async () => {
    const invalid = {
      ...input,
      expectedFrameworkVersion: '0.19.0',
    } as unknown as FrameworkRegistrationInput;
    const service = new FrameworkRegistryService(new MemoryStore(), probe, () => 'token');
    await expect(service.register(invalid)).rejects.toMatchObject({
      code: 'UNSUPPORTED_FRAMEWORK_VERSION',
    });
  });

  it('rejects URLs containing credentials, paths, or non-loopback plaintext', async () => {
    const service = new FrameworkRegistryService(new MemoryStore(), probe, () => 'token');
    for (const baseUrl of [
      'http://example.com',
      'https://user:pass@example.com',
      'https://example.com/control',
    ]) {
      await expect(service.register({ ...input, baseUrl })).rejects.toBeInstanceOf(
        FrameworkRegistryError,
      );
    }
  });

  it('fails closed when observed identity differs from registration', async () => {
    const mismatch: FrameworkProbe = {
      async inspect() {
        const value = await probe.inspect('', '');
        return { ...value, identity: { ...value.identity, frameworkId: 'hermes-other' } };
      },
    };
    const service = new FrameworkRegistryService(new MemoryStore(), mismatch, () => 'token');
    await expect(service.register(input)).rejects.toMatchObject({ code: 'FRAMEWORK_ID_MISMATCH' });
  });
});
