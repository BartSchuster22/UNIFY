import { describe, expect, it, vi } from 'vitest';
import { GovernanceService } from '../governance/service.js';
import type {
  AuditInput,
  AuditRecord,
  ClaimResult,
  EvidenceInput,
  GovernanceStore,
  NewOperation,
  OperationRecord,
  OperationState,
} from '../governance/types.js';
import { MutationOwnerClient } from '../migration/legacy/owner-client.js';
import type { MutationInput } from './types.js';
import { MutationService } from './service.js';

class Store implements GovernanceStore {
  readonly operations = new Map<string, OperationRecord>();
  readonly keys = new Map<string, { hash: string; operationId: string }>();
  readonly evidence: EvidenceInput[] = [];
  readonly audits: AuditInput[] = [];
  async ready() {
    return true;
  }
  async claimOperation(scope: string, key: string, input: NewOperation): Promise<ClaimResult> {
    const existing = this.keys.get(`${scope}:${key}`);
    if (existing)
      return existing.hash === input.requestHash
        ? { kind: 'replayed', operation: this.operations.get(existing.operationId)! }
        : { kind: 'conflict', operationId: existing.operationId };
    const now = new Date();
    const operation: OperationRecord = {
      id: `op-${this.operations.size + 1}`,
      actorUserId: input.actorUserId,
      action: input.action,
      targetFramework: input.targetFramework,
      targetKind: input.targetKind,
      targetId: input.targetId,
      state: 'pending',
      mode: input.mode ?? 'execute',
      policyDecision: input.policyDecision ?? 'allowed',
      sourceVersion: input.sourceVersion ?? null,
      requestHash: input.requestHash,
      idempotencyKey: input.idempotencyKey,
      result: null,
      error: null,
      evidenceIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.operations.set(operation.id, operation);
    this.keys.set(`${scope}:${key}`, { hash: input.requestHash, operationId: operation.id });
    return { kind: 'created', operation };
  }
  async getOperation(id: string) {
    return this.operations.get(id) ?? null;
  }
  async listOperations(limit: number) {
    return [...this.operations.values()].slice(0, limit);
  }
  async listAudit(): Promise<AuditRecord[]> {
    return [];
  }
  async transition(
    id: string,
    from: OperationState,
    to: OperationState,
    result?: unknown,
    error?: unknown,
  ) {
    const current = this.operations.get(id);
    if (!current || current.state !== from) return null;
    const updated: OperationRecord = {
      ...current,
      state: to,
      ...(result === undefined ? {} : { result }),
      ...(error === undefined ? {} : { error }),
      updatedAt: new Date(),
    };
    this.operations.set(id, updated);
    return updated;
  }
  async addEvidence(input: EvidenceInput) {
    this.evidence.push(input);
    return `ev-${this.evidence.length}`;
  }
  async appendAudit(input: AuditInput) {
    this.audits.push(input);
    return `audit-${this.audits.length}`;
  }
}

function owners() {
  return new MutationOwnerClient({
    agencyUrl: 'http://agency.invalid',
    agencyUsername: 'u',
    agencyPassword: 'p',
    dmmUrl: 'http://dmm.invalid',
    dmmUsername: 'u',
    dmmPassword: 'p',
    workerUrl: 'http://worker.invalid',
    workerToken: 'token',
    chatUrl: 'http://chat.invalid',
    chatPassword: 'p',
    memoryUrl: 'http://memory.invalid',
    memoryToken: 'token',
  });
}
function memory(role: string, lifecycle: string): MutationInput {
  return {
    operationType: 'memory.record.write',
    target: { owner: 'memory-v4', kind: 'memory-record', nativeId: 'rec-new' },
    payload: {
      entityType: 'project',
      entityId: 'unify',
      role,
      lifecycle,
      topic: 'phase-5',
      title: 'Evidence',
      content: 'verified',
    },
    mode: 'validate',
    confirmed: false,
  };
}

describe('mutation policy', () => {
  it('requires confirmation only when executing destructive operations', () => {
    const client = owners();
    const target = {
      owner: 'hermes' as const,
      kind: 'profile',
      nativeId: 'temporary',
      frameworkId: 'hermes',
    };
    expect(() =>
      client.validate({
        operationType: 'profile.delete',
        target,
        payload: {},
        mode: 'dry-run',
        confirmed: false,
      }),
    ).not.toThrow();
    expect(() =>
      client.validate({
        operationType: 'profile.delete',
        target,
        payload: {},
        mode: 'execute',
        confirmed: false,
      }),
    ).toThrowError(/confirmation/i);
  });
  it('allows only active/working and evidence working-or-live MemoryV4 writes', () => {
    const client = owners();
    expect(() => client.validate(memory('active', 'working'))).not.toThrow();
    expect(() => client.validate(memory('evidence', 'live'))).not.toThrow();
    expect(() => client.validate(memory('canonical', 'live'))).toThrowError(
      /only active\/working/i,
    );
    expect(() => client.validate(memory('active', 'live'))).toThrowError(/only active\/working/i);
  });
  it('rejects owner/kind mismatches and incomplete sensitive payloads', () => {
    const client = owners();
    expect(() =>
      client.validate({
        operationType: 'dmm.credential.save',
        target: { owner: 'worker', kind: 'provider', nativeId: 'openai' },
        payload: { secret: 'x' },
        mode: 'validate',
        confirmed: false,
      }),
    ).toThrowError(/target/i);
    expect(() =>
      client.validate({
        operationType: 'dmm.credential.save',
        target: { owner: 'dmm', kind: 'provider', nativeId: 'openai' },
        payload: {},
        mode: 'validate',
        confirmed: false,
      }),
    ).toThrowError(/secret/i);
  });
});

describe('mutation lifecycle', () => {
  it('persists only redacted results, writes evidence/audit, and replays idempotently', async () => {
    const store = new Store();
    const client = owners();
    const execute = vi
      .spyOn(client, 'execute')
      .mockResolvedValue({ ok: true, credential: { token: 'raw', status: 'valid' } });
    const service = new MutationService(new GovernanceService(store), client);
    const input: MutationInput = {
      operationType: 'dmm.credential.validate',
      target: { owner: 'dmm', kind: 'provider', nativeId: 'openai' },
      payload: {},
      mode: 'execute',
      confirmed: false,
    };
    const first = await service.run('u1', 'same-key', input);
    const replay = await service.run('u1', 'same-key', input);
    expect(first.operation.state).toBe('verified');
    expect(first.result).toEqual({ ok: true, credential: '[REDACTED]' });
    expect(store.operations.get(first.operation.id)?.result).toEqual(first.result);
    expect(store.evidence).toHaveLength(2);
    expect(store.audits.at(-1)?.outcome).toBe('success');
    expect(replay.replayed).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('routes Hermes-owned Work operations to the pinned Hermes control gateway without legacy fallback', async () => {
    const store = new Store();
    const client = owners();
    const legacyExecute = vi.spyOn(client, 'execute');
    const work = vi.fn().mockResolvedValue({
      data: { operation: 'task.create', result: { task: { id: 'task-1' } } },
    });
    const service = new MutationService(new GovernanceService(store), client, { work } as never);
    const input: MutationInput = {
      operationType: 'work.task.create',
      target: {
        owner: 'hermes',
        kind: 'task',
        nativeId: 'task-1',
        frameworkId: 'hermes-main',
      },
      payload: { boardId: 'alpha', title: 'Verify' },
      mode: 'execute',
      confirmed: false,
    };
    const result = await service.run('u1', 'hermes-work-key', input);
    expect(result.operation.state).toBe('verified');
    expect(work).toHaveBeenCalledWith(
      'hermes-main',
      'task.create',
      'task-1',
      input.payload,
      'execute',
      expect.objectContaining({ idempotencyKey: 'hermes-work-key' }),
    );
    expect(legacyExecute).not.toHaveBeenCalled();
  });

  it('records owner failure as error rather than a successful result', async () => {
    const store = new Store();
    const client = owners();
    vi.spyOn(client, 'execute').mockRejectedValue(new Error('owner unavailable'));
    const service = new MutationService(new GovernanceService(store), client);
    const input: MutationInput = {
      operationType: 'dmm.credential.validate',
      target: { owner: 'dmm', kind: 'provider', nativeId: 'openai' },
      payload: {},
      mode: 'execute',
      confirmed: false,
    };
    await expect(service.run('u1', 'failure-key', input)).rejects.toThrow('owner unavailable');
    const operation = [...store.operations.values()][0]!;
    expect(operation.state).toBe('failed');
    expect(operation.result).toBeNull();
    expect(operation.error).toEqual({ code: 'MUTATION_FAILED' });
    expect(store.audits.at(-1)?.outcome).toBe('failure');
  });
});
