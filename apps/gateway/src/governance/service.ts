import { canonicalHash, redactEvidence } from './canonical.js';
import type {
  AuditInput,
  GovernanceStore,
  NewOperation,
  OperationRecord,
  OperationState,
} from './types.js';

const TRANSITIONS: Record<OperationState, readonly OperationState[]> = {
  pending: ['validated', 'denied', 'failed'],
  validated: ['preflighted', 'denied', 'failed'],
  preflighted: ['awaiting_confirmation', 'executing', 'denied', 'failed'],
  awaiting_confirmation: ['executing', 'denied', 'failed'],
  executing: ['applied', 'failed', 'inconclusive', 'rolling_back'],
  applied: ['verifying', 'failed', 'rolling_back'],
  verifying: ['verified', 'failed', 'inconclusive', 'rolling_back'],
  verified: [],
  denied: [],
  failed: ['rolling_back'],
  inconclusive: ['verifying', 'rolling_back', 'failed'],
  rolling_back: ['rolled_back', 'rollback_failed'],
  rolled_back: [],
  rollback_failed: [],
};
export class GovernanceError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export class GovernanceService {
  constructor(
    private readonly store: GovernanceStore,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async begin(
    input: Omit<NewOperation, 'requestHash' | 'idempotencyKey'> & {
      idempotencyKey?: string;
      payload: unknown;
      scope?: string;
    },
  ) {
    if (!input.idempotencyKey?.trim())
      throw new GovernanceError('IDEMPOTENCY_KEY_REQUIRED', 400, 'Idempotency-Key is required');
    if (input.idempotencyKey.length > 200)
      throw new GovernanceError('IDEMPOTENCY_KEY_INVALID', 400, 'Idempotency-Key is too long');
    const operation: NewOperation = {
      actorUserId: input.actorUserId,
      action: input.action,
      requestHash: canonicalHash(input.payload),
      idempotencyKey: input.idempotencyKey,
      targetFramework: input.targetFramework,
      targetKind: input.targetKind,
      targetId: input.targetId,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.policyDecision ? { policyDecision: input.policyDecision } : {}),
      ...(input.sourceVersion ? { sourceVersion: input.sourceVersion } : {}),
    };
    const result = await this.store.claimOperation(
      input.scope ?? `${input.actorUserId}:${input.action}`,
      input.idempotencyKey,
      operation,
      new Date(this.now().getTime() + 24 * 60 * 60 * 1000),
    );
    if (result.kind === 'conflict')
      throw new GovernanceError(
        'IDEMPOTENCY_CONFLICT',
        409,
        `Idempotency key already belongs to operation ${result.operationId}`,
      );
    return result;
  }
  getOperation(operationId: string) {
    return this.store.getOperation(operationId);
  }
  async transition(
    operationId: string,
    to: OperationState,
    result?: unknown,
    error?: unknown,
  ): Promise<OperationRecord> {
    const current = await this.store.getOperation(operationId);
    if (!current) throw new GovernanceError('OPERATION_NOT_FOUND', 404, 'Operation not found');
    if (!TRANSITIONS[current.state].includes(to))
      throw new GovernanceError(
        'OPERATION_TRANSITION_INVALID',
        409,
        `Cannot transition ${current.state} to ${to}`,
      );
    const updated = await this.store.transition(operationId, current.state, to, result, error);
    if (!updated)
      throw new GovernanceError(
        'OPERATION_CONCURRENT_UPDATE',
        409,
        'Operation changed concurrently',
      );
    return updated;
  }
  async evidence(
    operationId: string | undefined,
    kind: string,
    payload: unknown,
    storageUri = 'postgres://evidence',
  ) {
    const redacted = redactEvidence(payload);
    return this.store.addEvidence({
      ...(operationId ? { operationId } : {}),
      kind,
      sha256: canonicalHash(redacted),
      storageUri,
      redactedPayload: redacted,
      metadata: { redacted: true },
    });
  }
  audit(input: AuditInput) {
    return this.store.appendAudit({
      ...input,
      details: redactEvidence(input.details ?? {}) as Record<string, unknown>,
    });
  }
}
