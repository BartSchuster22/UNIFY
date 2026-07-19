import { describe, expect, it } from 'vitest';
import { canonicalHash, canonicalJson, redactEvidence } from './governance/canonical.js';
import { GovernanceError, GovernanceService } from './governance/service.js';
import type {
  AuditInput,
  ClaimResult,
  EvidenceInput,
  GovernanceStore,
  NewOperation,
  OperationRecord,
  OperationState,
} from './governance/types.js';

class MemoryGovernanceStore implements GovernanceStore {
  operations = new Map<string, OperationRecord>();
  keys = new Map<string, { hash: string; operationId: string }>();
  evidence: EvidenceInput[] = [];
  audits: AuditInput[] = [];
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
      targetFramework: input.targetFramework ?? null,
      targetKind: input.targetKind ?? null,
      targetId: input.targetId ?? null,
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
  async transition(
    id: string,
    from: OperationState,
    to: OperationState,
    result?: unknown,
    error?: unknown,
  ) {
    const operation = this.operations.get(id);
    if (!operation || operation.state !== from) return null;
    const updated = {
      ...operation,
      state: to,
      result: result ?? operation.result,
      error: error ?? operation.error,
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

describe('canonical operation payloads', () => {
  it('produces a stable hash regardless of object insertion order', () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: 'x' } })).toBe(
      '{"nested":{"a":"x","b":true},"z":1}',
    );
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });
  it('rejects values outside JSON', () => {
    expect(() => canonicalJson({ bad: Number.NaN })).toThrow(/non-finite/);
  });
});

describe('idempotent operation lifecycle', () => {
  it('replays the same request and rejects key reuse with another payload', async () => {
    const store = new MemoryGovernanceStore();
    const service = new GovernanceService(store);
    const first = await service.begin({
      actorUserId: 'u1',
      action: 'framework.start',
      targetFramework: 'agency',
      targetKind: 'project',
      targetId: 'x',
      idempotencyKey: 'key-1',
      payload: { id: 'x' },
    });
    const replay = await service.begin({
      actorUserId: 'u1',
      action: 'framework.start',
      targetFramework: 'agency',
      targetKind: 'project',
      targetId: 'x',
      idempotencyKey: 'key-1',
      payload: { id: 'x' },
    });
    expect(first.kind).toBe('created');
    expect(replay.kind).toBe('replayed');
    expect(replay.operation.id).toBe(first.operation.id);
    await expect(
      service.begin({
        actorUserId: 'u1',
        action: 'framework.start',
        targetFramework: 'agency',
        targetKind: 'project',
        targetId: 'x',
        idempotencyKey: 'key-1',
        payload: { id: 'different' },
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', statusCode: 409 });
  });
  it('requires an idempotency key', async () => {
    await expect(
      new GovernanceService(new MemoryGovernanceStore()).begin({
        actorUserId: 'u1',
        action: 'x',
        targetFramework: 'agency',
        targetKind: 'project',
        targetId: 'x',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });
  it('enforces forward-only state transitions', async () => {
    const service = new GovernanceService(new MemoryGovernanceStore());
    const started = await service.begin({
      actorUserId: 'u1',
      action: 'x',
      targetFramework: 'agency',
      targetKind: 'project',
      targetId: 'x',
      idempotencyKey: 'k',
      payload: {},
    });
    const validated = await service.transition(started.operation.id, 'validated');
    const preflighted = await service.transition(validated.id, 'preflighted');
    const running = await service.transition(preflighted.id, 'executing');
    expect(running.state).toBe('executing');
    const applied = await service.transition(running.id, 'applied', { ok: true });
    const verifying = await service.transition(applied.id, 'verifying');
    const done = await service.transition(verifying.id, 'verified');
    expect(done.state).toBe('verified');
    await expect(service.transition(done.id, 'executing')).rejects.toBeInstanceOf(GovernanceError);
  });
});

describe('evidence and audit redaction', () => {
  it('redacts sensitive keys recursively without mutating safe fields', () => {
    expect(
      redactEvidence({
        authorization: 'Bearer x',
        safe: 'yes',
        nested: { api_key: 'secret', items: [{ password: 'p' }] },
      }),
    ).toEqual({
      authorization: '[REDACTED]',
      safe: 'yes',
      nested: { api_key: '[REDACTED]', items: [{ password: '[REDACTED]' }] },
    });
  });
  it('stores only redacted evidence and audit details', async () => {
    const store = new MemoryGovernanceStore();
    const service = new GovernanceService(store);
    await service.evidence(undefined, 'probe', { result: 'ok', token: 'raw' });
    await service.audit({
      action: 'auth.login',
      outcome: 'success',
      details: { cookie: 'raw', safe: 1 },
    });
    expect(store.evidence[0]?.redactedPayload).toEqual({ result: 'ok', token: '[REDACTED]' });
    expect(store.audits[0]?.details).toEqual({ cookie: '[REDACTED]', safe: 1 });
  });
});
