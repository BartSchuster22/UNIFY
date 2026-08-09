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
import { MutationService } from './service.js';
import type { MutationInput } from './types.js';

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

function taskInput(): MutationInput {
  return {
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
}

function hermes(
  work: ReturnType<typeof vi.fn>,
  conversation = vi.fn(),
  modelManagement = vi.fn(),
  profileManagement = vi.fn(),
) {
  return { work, conversation, modelManagement, profileManagement, reconcile: vi.fn() } as never;
}

describe('standalone mutation policy', () => {
  it('rejects every non-Hermes owner and unsupported legacy operation before execution', () => {
    const service = new MutationService(new GovernanceService(new Store()), hermes(vi.fn()));
    expect(() =>
      service.parse({
        operationType: 'memory.record.write',
        target: { owner: 'memory-v4', kind: 'memory-record', nativeId: 'record-1' },
        payload: {},
        mode: 'execute',
        confirmed: true,
      }),
    ).toThrowError(/owner is not supported/i);
    expect(() =>
      service.parse({
        operationType: 'worker.task.create',
        target: { owner: 'hermes', kind: 'task', nativeId: 'task-1' },
        payload: {},
      }),
    ).toThrowError(/not supported/i);
  });

  it('executes only through Hermes, persists redacted evidence, and replays idempotently', async () => {
    const store = new Store();
    const work = vi.fn().mockResolvedValue({
      data: { operation: 'task.create', credential: { token: 'raw', status: 'valid' } },
    });
    const service = new MutationService(new GovernanceService(store), hermes(work));
    const input = taskInput();
    const first = await service.run('u1', 'hermes-work-key', input);
    const replay = await service.run('u1', 'hermes-work-key', input);

    expect(first.operation.state).toBe('verified');
    expect(first.result).toEqual({
      data: { operation: 'task.create', credential: '[REDACTED]' },
    });
    expect(store.operations.get(first.operation.id)?.result).toEqual(first.result);
    expect(store.evidence).toHaveLength(2);
    expect(store.audits.at(-1)?.outcome).toBe('success');
    expect(replay.replayed).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledWith(
      'hermes-main',
      'task.create',
      'task-1',
      input.payload,
      'execute',
      expect.objectContaining({ idempotencyKey: 'hermes-work-key' }),
    );
  });

  it('routes governed conversation mutations to the selected registered framework', async () => {
    const conversation = vi.fn().mockResolvedValue({
      data: { status: 'completed', operation: 'session.create', targetId: 'session-1' },
    });
    const service = new MutationService(
      new GovernanceService(new Store()),
      hermes(vi.fn(), conversation),
    );
    const input = service.parse({
      operationType: 'conversation.session.create',
      target: {
        owner: 'hermes',
        kind: 'session',
        nativeId: 'session-1',
        frameworkId: 'hermes-alica',
      },
      payload: { title: 'Phase 14.5 conversation' },
      mode: 'execute',
    });
    const result = await service.run('u1', 'conversation-key', input);
    expect(result.operation.state).toBe('verified');
    expect(conversation).toHaveBeenCalledWith(
      'hermes-alica',
      'session.create',
      'session-1',
      input.payload,
      'execute',
      expect.objectContaining({ idempotencyKey: 'conversation-key' }),
    );
  });

  it('governs profile rename with framework isolation, source version, confirmation, and replay', async () => {
    const store = new Store();
    const profileManagement = vi.fn().mockResolvedValue({
      data: { status: 'completed', operation: 'profile.rename', targetId: 'default' },
    });
    const service = new MutationService(
      new GovernanceService(store),
      hermes(vi.fn(), vi.fn(), vi.fn(), profileManagement),
    );
    const raw = {
      operationType: 'profile.rename',
      target: {
        owner: 'hermes',
        kind: 'profile',
        nativeId: 'default',
        frameworkId: 'hermes-herman',
      },
      payload: { newId: 'herman', expectedSourceVersion: 'sha256:profiles-v1' },
      mode: 'execute',
      confirmed: true,
    };
    const input = service.parse(raw);
    const first = await service.run('u1', 'profile-rename-key', input);
    const replay = await service.run('u1', 'profile-rename-key', input);
    expect(first.operation.state).toBe('verified');
    expect(replay.replayed).toBe(true);
    expect(profileManagement).toHaveBeenCalledTimes(1);
    expect(profileManagement).toHaveBeenCalledWith(
      'hermes-herman',
      'profile.rename',
      'default',
      raw.payload,
      'execute',
      expect.objectContaining({ idempotencyKey: 'profile-rename-key' }),
    );

    for (const invalid of [
      { ...raw, confirmed: false },
      { ...raw, payload: { ...raw.payload, newId: 'default' } },
      { ...raw, payload: { newId: 'herman' } },
      { ...raw, target: { ...raw.target, frameworkId: undefined } },
    ])
      expect(() => service.parse(invalid)).toThrow();
  });

  it('routes credential management with dedicated RBAC and never persists the credential', async () => {
    const store = new Store();
    const modelManagement = vi.fn().mockResolvedValue({
      data: { status: 'completed', operation: 'provider.credential.set', targetId: 'openrouter' },
    });
    const service = new MutationService(
      new GovernanceService(store),
      hermes(vi.fn(), vi.fn(), modelManagement),
    );
    const input = service.parse({
      operationType: 'provider.credential.set',
      target: {
        owner: 'hermes',
        kind: 'provider',
        nativeId: 'openrouter',
        frameworkId: 'hermes-alica',
      },
      payload: { credential: 'raw-provider-secret' },
      mode: 'execute',
      confirmed: false,
    });

    expect(service.permission(input)).toBe('credentials.manage');
    const result = await service.run('u1', 'credential-key', input);
    expect(result.operation.state).toBe('verified');
    expect(modelManagement).toHaveBeenCalledWith(
      'hermes-alica',
      'provider.credential.set',
      'openrouter',
      { credential: 'raw-provider-secret' },
      'execute',
      expect.objectContaining({ idempotencyKey: 'credential-key' }),
    );
    expect(
      JSON.stringify({
        operations: [...store.operations.values()],
        evidence: store.evidence,
        audits: store.audits,
      }),
    ).not.toContain('raw-provider-secret');
  });

  it('requires confirmation for credential removal and maps model selection to models.manage', () => {
    const service = new MutationService(new GovernanceService(new Store()), hermes(vi.fn()));
    expect(() =>
      service.parse({
        operationType: 'provider.credential.remove',
        target: {
          owner: 'hermes',
          kind: 'provider',
          nativeId: 'openrouter',
          frameworkId: 'hermes-main',
        },
        payload: {},
        mode: 'execute',
        confirmed: false,
      }),
    ).toThrow(/confirmation/i);
    const model = service.parse({
      operationType: 'model.select',
      target: {
        owner: 'hermes',
        kind: 'model',
        nativeId: 'openai/gpt-5',
        frameworkId: 'hermes-main',
      },
      payload: { providerId: 'openrouter', confirmExpensiveModel: true },
      mode: 'execute',
    });
    expect(service.permission(model)).toBe('models.manage');
  });

  it('records Hermes failure as an error rather than a successful result', async () => {
    const store = new Store();
    const work = vi.fn().mockRejectedValue(new Error('Hermes unavailable'));
    const service = new MutationService(new GovernanceService(store), hermes(work));
    await expect(service.run('u1', 'failure-key', taskInput())).rejects.toThrow(
      'Hermes unavailable',
    );
    const operation = [...store.operations.values()][0]!;
    expect(operation.state).toBe('failed');
    expect(operation.result).toBeNull();
    expect(operation.error).toEqual({ code: 'MUTATION_FAILED' });
    expect(store.audits.at(-1)?.outcome).toBe('failure');
  });
});
