import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
} from '@aquiero/contracts';
import { describe, expect, it, vi } from 'vitest';
import { FrameworkRegistryService } from '../framework-registry/service.js';
import type {
  FrameworkProbe,
  FrameworkRegistrationRecord,
  FrameworkRegistrationStore,
} from '../framework-registry/types.js';
import { HermesControlClient } from './client.js';
import type { FrameworkEventCursor, FrameworkEventJournal } from './event-journal.js';
import { HermesGatewayService } from './service.js';

class Store implements FrameworkRegistrationStore {
  constructor(readonly record: FrameworkRegistrationRecord) {}
  async ready() {
    return true;
  }
  async list() {
    return [this.record];
  }
  async get(id: string) {
    return id === this.record.frameworkId ? this.record : null;
  }
  async upsert(value: FrameworkRegistrationRecord) {
    return value;
  }
  async remove() {
    return false;
  }
}
class Journal implements FrameworkEventJournal {
  async ready() {
    return true;
  }
  async cursor(): Promise<FrameworkEventCursor> {
    return { lastSequence: 0, state: 'current' };
  }
  async ingest() {
    return 0;
  }
  async list() {
    return [];
  }
  async markUnavailable() {
    return undefined;
  }
}
const probe: FrameworkProbe = {
  async inspect() {
    throw new Error('unused');
  },
};
const record: FrameworkRegistrationRecord = {
  frameworkId: 'hermes-main',
  displayName: 'Main Hermes',
  baseUrl: 'http://127.0.0.1:18799',
  serviceAuthReference: 'env:HERMES_TEST_TOKEN',
  serviceAuthConfigured: true,
  scopes: ['control:read', 'control:events', 'control:execute'],
  contractVersion: HERMES_CONTROL_VERSION,
  frameworkVersion: PINNED_HERMES_RELEASE,
  frameworkCommit: PINNED_HERMES_COMMIT,
  status: 'verified',
  enabled: true,
  verifiedAt: '2026-07-21T12:00:00.000Z',
  createdAt: '2026-07-21T12:00:00.000Z',
  updatedAt: '2026-07-21T12:00:00.000Z',
};
const meta = {
  contractVersion: HERMES_CONTROL_VERSION,
  frameworkId: 'hermes-main',
  frameworkVersion: PINNED_HERMES_RELEASE,
  frameworkCommit: PINNED_HERMES_COMMIT,
  sourceVersion: 'snapshot:v1',
  observedAt: '2026-07-21T12:00:00.000Z',
};

function service(body: unknown, current = record) {
  const fetchImpl = vi.fn(async () => Response.json(body)) as unknown as typeof fetch;
  const registry = new FrameworkRegistryService(new Store(current), probe, () => 'service-token');
  return {
    fetchImpl,
    gateway: new HermesGatewayService(
      registry,
      new Journal(),
      (connection) =>
        new HermesControlClient({
          baseUrl: connection.baseUrl,
          bearerToken: connection.bearerToken,
          fetchImpl,
          retries: 0,
        }),
    ),
  };
}

describe('HermesGatewayService profile/provider truth', () => {
  it('projects profile ownership and provenance without storing a second profile record', async () => {
    const { gateway } = service({
      ...meta,
      data: {
        items: [{ id: 'default', displayName: 'Herman', active: true, gatewayStatus: 'running' }],
        page: { hasMore: false },
      },
    });
    await expect(gateway.profiles('hermes-main', { limit: 100 })).resolves.toMatchObject({
      meta: { owner: 'hermes', frameworkId: 'hermes-main', sourceVersion: 'snapshot:v1' },
      items: [{ id: 'default', owner: 'hermes', frameworkId: 'hermes-main' }],
    });
  });

  it('projects only safe provider credential status', async () => {
    const { gateway } = service({
      ...meta,
      data: {
        items: [
          {
            id: 'openai-codex',
            displayName: 'OpenAI Codex',
            credentialStatus: 'configured',
            selected: true,
          },
        ],
        page: { hasMore: false },
      },
    });
    const result = await gateway.providers('hermes-main', { limit: 100 });
    expect(result.items[0]).toMatchObject({ owner: 'hermes', credentialStatus: 'configured' });
    expect(JSON.stringify(result)).not.toMatch(/token|secret|fingerprint|API_KEY/i);
  });

  it('promotes a model-management source precondition into the Hermes command envelope', async () => {
    const scoped = {
      ...record,
      scopes: [...record.scopes, 'control:secrets'] as FrameworkRegistrationRecord['scopes'],
    };
    const { gateway, fetchImpl } = service(
      {
        ...meta,
        data: {
          operationId: 'owner-operation',
          status: 'dry-run',
          replayed: false,
          operation: 'provider.credential.set',
          targetId: 'openrouter',
          result: {},
          emittedEvents: 0,
        },
      },
      scoped,
    );
    await gateway.modelManagement(
      'hermes-main',
      'provider.credential.set',
      'openrouter',
      { credential: 'owner-only-secret', expectedSourceVersion: 'catalogue:v7' },
      'dry-run',
      { actorUserId: 'operator', operationId: 'gateway-operation', idempotencyKey: 'setup-key' },
    );
    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    const command = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(command.expectedSourceVersion).toBe('catalogue:v7');
    expect(command.payload).toEqual({ credential: 'owner-only-secret' });
  });

  it('promotes Work and Chat source preconditions without leaking them into owner payloads', async () => {
    const body = {
      ...meta,
      data: {
        operationId: 'owner-operation',
        status: 'completed',
        replayed: false,
        operation: 'task.complete',
        targetId: 'TASK-1',
        result: {},
        emittedEvents: 0,
      },
    };
    const workHarness = service(body);
    await workHarness.gateway.work(
      'hermes-main',
      'task.complete',
      'TASK-1',
      { boardId: 'alpha', expectedSourceVersion: 'tasks:v4' },
      'execute',
      { actorUserId: 'operator', operationId: 'work-op', idempotencyKey: 'work-key' },
    );
    const workCommand = JSON.parse(
      String(vi.mocked(workHarness.fetchImpl).mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(workCommand.expectedSourceVersion).toBe('tasks:v4');
    expect(workCommand.payload).toEqual({ boardId: 'alpha' });

    const chatHarness = service({
      ...body,
      data: { ...body.data, operation: 'message.send', targetId: 'session-1' },
    });
    await chatHarness.gateway.conversation(
      'hermes-main',
      'message.send',
      'session-1',
      { sessionId: 'session-1', message: 'hello', expectedSourceVersion: 'messages:v8' },
      'execute',
      { actorUserId: 'operator', operationId: 'chat-op', idempotencyKey: 'chat-key' },
    );
    const chatCommand = JSON.parse(
      String(vi.mocked(chatHarness.fetchImpl).mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(chatCommand.expectedSourceVersion).toBe('messages:v8');
    expect(chatCommand.payload).toEqual({ sessionId: 'session-1', message: 'hello' });
  });

  it('fails closed on framework provenance mismatch', async () => {
    const { gateway } = service({
      ...meta,
      frameworkId: 'hermes-other',
      data: { items: [], page: { hasMore: false } },
    });
    await expect(gateway.profiles('hermes-main', {})).rejects.toMatchObject({
      code: 'FRAMEWORK_PROVENANCE_MISMATCH',
    });
  });

  it('denies reads before network access when control:read is not registered', async () => {
    const scoped = {
      ...record,
      scopes: ['control:events'] as FrameworkRegistrationRecord['scopes'],
    };
    const { gateway, fetchImpl } = service({}, scoped);
    await expect(gateway.profiles('hermes-main', {})).rejects.toMatchObject({
      code: 'FRAMEWORK_SCOPE_DENIED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
