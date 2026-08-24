import { describe, expect, it, vi } from 'vitest';
import { FederationLeaseService } from './service.js';
import type {
  FederationClaimResult,
  FederationLeaseInput,
  FederationLeaseRecord,
  FederationLeaseStage,
  FederationLeaseStatus,
  FederationLeaseStore,
} from './types.js';

function lease(input: FederationLeaseInput & { requestHash: string }): FederationLeaseRecord {
  const now = new Date('2026-08-24T00:00:00.000Z');
  return {
    id: 'lease-1',
    sourceFrameworkId: input.sourceFrameworkId,
    sourceBoardId: input.sourceBoardId,
    sourceTaskId: input.sourceTaskId,
    workerFrameworkId: input.workerFrameworkId,
    workerBoardId: input.workerBoardId,
    workerProfileId: input.workerProfileId,
    workerTaskId: null,
    status: 'pending',
    stage: 'pending',
    attempt: 1,
    leaseExpiresAt: now,
    heartbeatAt: now,
    requestHash: input.requestHash,
    result: null,
    error: null,
    createdBy: input.actorUserId,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryStore implements FederationLeaseStore {
  record: FederationLeaseRecord | null = null;
  async ready() {
    return true;
  }
  async claim(
    input: FederationLeaseInput & { requestHash: string },
  ): Promise<FederationClaimResult> {
    if (this.record)
      return this.record.requestHash === input.requestHash
        ? { kind: 'replayed', lease: this.record }
        : { kind: 'conflict', lease: this.record };
    this.record = lease(input);
    return { kind: 'created', lease: this.record };
  }
  async get(id: string) {
    return this.record?.id === id ? this.record : null;
  }
  async list() {
    return this.record ? [this.record] : [];
  }
  async advance(
    id: string,
    stage: FederationLeaseStage,
    status: FederationLeaseStatus,
    patch: { workerTaskId?: string; result?: unknown; error?: unknown } = {},
  ) {
    if (!this.record || this.record.id !== id) return null;
    this.record = {
      ...this.record,
      stage,
      status,
      workerTaskId: patch.workerTaskId ?? this.record.workerTaskId,
      result: patch.result ?? this.record.result,
      error: patch.error ?? this.record.error,
    };
    return this.record;
  }
}

function fixture() {
  const store = new MemoryStore();
  const work = vi.fn(async (...args: unknown[]) => {
    const operation = String(args[1]);
    return {
      data: {
        operationId: 'owner-op',
        status: 'completed',
        replayed: false,
        operation,
        targetId: operation === 'task.run' ? 'reviewer' : 'task',
        result: { taskRun: { profileId: 'reviewer', result: 'worker result' } },
        emittedEvents: 0,
      },
    };
  });
  const service = new FederationLeaseService(store, { work } as never);
  return { service, store, work };
}

const body = {
  sourceFrameworkId: 'hermes-alica',
  sourceBoardId: 'alica',
  sourceTaskId: 'ALICA-1',
  sourceSourceVersion: 'tasks:v1',
  workerFrameworkId: 'hermes-herman',
  workerProfileId: 'reviewer',
  prompt: 'Investigate this source task',
};

describe('Cross-Hermes worker federation leases', () => {
  it('starts the source, runs exactly one native Herman worker profile, and completes the source from worker evidence', async () => {
    const { service, work } = fixture();
    const result = await service.createOrResume('operator-1', 'idem-1', body);

    expect(result.replayed).toBe(false);
    expect(result.lease.status).toBe('completed');
    expect(result.lease.worker).toMatchObject({
      frameworkId: 'hermes-herman',
      boardId: 'native',
      profileId: 'reviewer',
      taskId: null,
    });
    expect(work.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ['hermes-alica', 'task.start', 'ALICA-1'],
      ['hermes-herman', 'task.run', 'reviewer'],
      ['hermes-alica', 'task.complete', 'ALICA-1'],
    ]);
    expect(work.mock.calls[1]?.[3]).toMatchObject({
      profileId: 'reviewer',
      prompt: 'Investigate this source task',
    });
    expect(work.mock.calls[1]?.[3]).not.toHaveProperty('expectedSourceVersion');
    expect(work.mock.calls[1]?.[5]).toMatchObject({
      actorUserId: 'operator-1',
      idempotencyKey: 'idem-1:worker-run',
    });
    expect(work.mock.calls[2]?.[3]).toMatchObject({ result: 'worker result' });
  });

  it('replays a completed durable lease without duplicate native worker execution', async () => {
    const { service, work } = fixture();
    await service.createOrResume('operator-1', 'idem-1', body);
    work.mockClear();
    const result = await service.createOrResume('operator-1', 'idem-1', body);

    expect(result.replayed).toBe(true);
    expect(work).not.toHaveBeenCalled();
  });

  it('resumes only missing stages and never reruns the worker after persisted worker result exists', async () => {
    const { service, store, work } = fixture();
    await service.createOrResume('operator-1', 'idem-1', body);
    const persisted = store.record!;
    store.record = { ...persisted, status: 'running', stage: 'worker-completed' };
    work.mockClear();

    await service.createOrResume('operator-1', 'idem-1', body);

    expect(work.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ['hermes-alica', 'task.complete', 'ALICA-1'],
    ]);
  });

  it('resumes missing worker and source completion after a lease was replayed at source-started', async () => {
    const { service, store, work } = fixture();
    await service.createOrResume('operator-1', 'idem-1', body);
    const persisted = store.record!;
    store.record = { ...persisted, status: 'pending', stage: 'source-started', result: null };
    work.mockClear();

    await service.createOrResume('operator-1', 'idem-1', body);

    expect(work.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ['hermes-herman', 'task.run', 'reviewer'],
      ['hermes-alica', 'task.complete', 'ALICA-1'],
    ]);
  });

  it('fails closed after restart at worker-running instead of duplicating native execution', async () => {
    const { service, store, work } = fixture();
    await service.createOrResume('operator-1', 'idem-1', body);
    const persisted = store.record!;
    store.record = { ...persisted, status: 'running', stage: 'worker-running', result: null };
    work.mockClear();

    await expect(service.createOrResume('operator-1', 'idem-1', body)).rejects.toMatchObject({
      code: 'FEDERATION_WORKER_OUTCOME_UNKNOWN',
    });
    expect(work.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ['hermes-alica', 'task.block', 'ALICA-1'],
    ]);
    expect(store.record).toMatchObject({ status: 'failed', stage: 'source-blocked' });
  });

  it('fails closed on non-canonical or same-framework federation', async () => {
    const { service } = fixture();
    await expect(
      service.createOrResume('operator-1', 'idem-1', {
        ...body,
        workerFrameworkId: 'hermes-alica',
      }),
    ).rejects.toMatchObject({ code: 'FEDERATION_FRAMEWORK_INVALID' });
  });

  it('rejects caller-supplied result before any worker execution', async () => {
    const { service, work } = fixture();
    await expect(
      service.createOrResume('operator-1', 'idem-1', {
        ...body,
        result: 'forged',
      } as never),
    ).rejects.toMatchObject({ code: 'FEDERATION_PAYLOAD_INVALID' });
    expect(work).not.toHaveBeenCalled();
  });

  it('blocks the source task when the worker framework fails', async () => {
    const store = new MemoryStore();
    const work = vi
      .fn()
      .mockResolvedValueOnce({ data: { result: { task: { id: 'source' } } } })
      .mockRejectedValueOnce(new Error('worker down'))
      .mockResolvedValueOnce({ data: { result: { task: { id: 'source' } } } });
    const service = new FederationLeaseService(store, { work } as never);

    await expect(service.createOrResume('operator-1', 'idem-1', body)).rejects.toMatchObject({
      code: 'FEDERATION_WORKER_FAILED',
    });
    expect(store.record).toMatchObject({ status: 'failed', stage: 'source-blocked' });
    expect(work.mock.calls.at(-1)?.slice(0, 3)).toEqual(['hermes-alica', 'task.block', 'ALICA-1']);
  });
});
