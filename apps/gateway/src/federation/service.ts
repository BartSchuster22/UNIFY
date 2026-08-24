import { createHash } from 'node:crypto';
import { GovernanceError } from '../governance/service.js';
import type { HermesGatewayService } from '../hermes-control/service.js';
import type { FederationLeaseInput, FederationLeaseRecord, FederationLeaseStore } from './types.js';

export type FederationCreateBody = {
  sourceFrameworkId: string;
  sourceBoardId: string;
  sourceTaskId: string;
  sourceSourceVersion: string;
  workerFrameworkId: string;
  workerProfileId: string;
  prompt: string;
  leaseTtlSeconds?: number;
  workerTimeoutSeconds?: number;
};

const CANONICAL_SOURCE = 'hermes-alica';
const CANONICAL_WORKER = 'hermes-herman';
const MAX_PROMPT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 128 * 1024;

export class FederationLeaseService {
  constructor(
    private readonly store: FederationLeaseStore,
    private readonly hermes: HermesGatewayService,
  ) {}

  ready() {
    return this.store.ready();
  }

  get(id: string) {
    return this.store.get(id);
  }

  list(limit = 100) {
    return this.store.list(Math.min(Math.max(limit, 1), 500));
  }

  async createOrResume(actorUserId: string, idempotencyKey: string, body: FederationCreateBody) {
    const input = parseInput(actorUserId, idempotencyKey, body);
    const requestHash = hashInput(input);
    const claim = await this.store.claim({ ...input, requestHash });
    if (claim.kind === 'conflict')
      throw new GovernanceError(
        'FEDERATION_SOURCE_CONFLICT',
        409,
        'A distinct worker federation lease already exists for this source card',
      );

    let lease = claim.lease;
    if (lease.stage === 'source-completed')
      return { replayed: claim.kind === 'replayed', lease: publicLease(lease) };

    try {
      if (lease.stage === 'pending') {
        await this.hermes.work(
          input.sourceFrameworkId,
          'task.start',
          input.sourceTaskId,
          { boardId: input.sourceBoardId, expectedSourceVersion: input.sourceSourceVersion },
          'execute',
          { actorUserId, operationId: lease.id, idempotencyKey: `${idempotencyKey}:source-start` },
        );
        lease = (await this.store.advance(lease.id, 'source-started', 'pending')) ?? lease;
      }

      let workerResult = persistedWorkerResult(lease);
      if (!workerResult) {
        if (lease.stage === 'worker-running')
          throw new GovernanceError(
            'FEDERATION_WORKER_OUTCOME_UNKNOWN',
            502,
            'Worker execution was interrupted after its durable claim; refusing duplicate execution',
          );
        lease = (await this.store.advance(lease.id, 'worker-running', 'running')) ?? lease;
        const worker = await this.hermes.work(
          input.workerFrameworkId,
          'task.run',
          input.workerProfileId,
          {
            profileId: input.workerProfileId,
            prompt: input.prompt,
            timeoutSeconds: body.workerTimeoutSeconds,
          },
          'execute',
          { actorUserId, operationId: lease.id, idempotencyKey: `${idempotencyKey}:worker-run` },
        );
        workerResult = extractWorkerResult(worker.data);
        lease =
          (await this.store.advance(lease.id, 'worker-completed', 'running', {
            result: workerResult,
          })) ?? lease;
      }

      if (lease.stage !== 'source-completed') {
        await this.hermes.work(
          input.sourceFrameworkId,
          'task.complete',
          input.sourceTaskId,
          {
            boardId: input.sourceBoardId,
            result: workerResult.result,
            expectedSourceVersion: input.sourceSourceVersion,
          },
          'execute',
          {
            actorUserId,
            operationId: lease.id,
            idempotencyKey: `${idempotencyKey}:source-complete`,
          },
        );
        lease =
          (await this.store.advance(lease.id, 'source-completed', 'completed', {
            result: workerResult,
          })) ?? lease;
      }
      return { replayed: claim.kind === 'replayed', lease: publicLease(lease) };
    } catch (error) {
      const safeError = {
        code: error instanceof GovernanceError ? error.code : 'FEDERATION_WORKER_FAILED',
        message: error instanceof Error ? error.message.slice(0, 500) : 'Federated worker failed',
      };
      try {
        await this.hermes.work(
          input.sourceFrameworkId,
          'task.block',
          input.sourceTaskId,
          {
            boardId: input.sourceBoardId,
            reason: `Federated worker failed: ${safeError.code}`,
            expectedSourceVersion: input.sourceSourceVersion,
          },
          'execute',
          { actorUserId, operationId: lease.id, idempotencyKey: `${idempotencyKey}:source-block` },
        );
      } catch {
        // The durable lease failure remains the authoritative recovery signal.
      }
      lease =
        (await this.store.advance(lease.id, 'source-blocked', 'failed', { error: safeError })) ??
        lease;
      throw new GovernanceError(safeError.code, 502, safeError.message);
    }
  }
}

function parseInput(
  actorUserId: string,
  idempotencyKey: string,
  body: FederationCreateBody,
): FederationLeaseInput {
  if ('result' in (body as Record<string, unknown>))
    throw new GovernanceError(
      'FEDERATION_PAYLOAD_INVALID',
      422,
      'Caller-supplied federation result is forbidden; source completion must use native worker output',
    );
  const sourceFrameworkId = required(body.sourceFrameworkId, 'sourceFrameworkId', 128);
  const workerFrameworkId = required(body.workerFrameworkId, 'workerFrameworkId', 128);
  if (sourceFrameworkId !== CANONICAL_SOURCE || workerFrameworkId !== CANONICAL_WORKER)
    throw new GovernanceError(
      'FEDERATION_FRAMEWORK_INVALID',
      422,
      'Federation requires canonical hermes-alica source and hermes-herman worker frameworks',
    );
  const prompt = required(body.prompt, 'prompt', MAX_PROMPT_BYTES);
  return {
    actorUserId,
    idempotencyKey,
    sourceFrameworkId,
    sourceBoardId: required(body.sourceBoardId, 'sourceBoardId', 200),
    sourceTaskId: required(body.sourceTaskId, 'sourceTaskId', 300),
    sourceSourceVersion: required(body.sourceSourceVersion, 'sourceSourceVersion', 500),
    workerFrameworkId,
    workerBoardId: 'native',
    workerProfileId: required(body.workerProfileId, 'workerProfileId', 200),
    prompt,
    leaseTtlSeconds:
      Number.isInteger(body.leaseTtlSeconds) && body.leaseTtlSeconds! >= 60
        ? Math.min(body.leaseTtlSeconds!, 24 * 60 * 60)
        : 60 * 60,
  };
}

function required(value: unknown, name: string, maxBytes: number) {
  if (typeof value !== 'string' || !value.trim())
    throw new GovernanceError('FEDERATION_PAYLOAD_INVALID', 422, `${name} is required`);
  return bounded(value.trim(), maxBytes, name);
}

function bounded(value: string, maxBytes: number, name: string) {
  if (Buffer.byteLength(value, 'utf8') > maxBytes)
    throw new GovernanceError(
      'FEDERATION_PAYLOAD_INVALID',
      413,
      `${name} exceeds federation limit`,
    );
  return value;
}

function hashInput(input: FederationLeaseInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sourceFrameworkId: input.sourceFrameworkId,
        sourceBoardId: input.sourceBoardId,
        sourceTaskId: input.sourceTaskId,
        workerFrameworkId: input.workerFrameworkId,
        workerProfileId: input.workerProfileId,
        prompt: input.prompt,
      }),
    )
    .digest('hex');
}

type WorkerResult = { profileId: string; result: string };

function persistedWorkerResult(lease: FederationLeaseRecord): WorkerResult | null {
  return parseWorkerResult(lease.result);
}

function extractWorkerResult(result: unknown): WorkerResult {
  const envelope = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const source = envelope.result ?? envelope;
  const taskRun =
    source && typeof source === 'object' ? (source as Record<string, unknown>).taskRun : undefined;
  const row =
    taskRun && typeof taskRun === 'object' ? (taskRun as Record<string, unknown>) : source;
  const parsed = parseWorkerResult(row);
  if (parsed) return parsed;
  throw new GovernanceError(
    'FEDERATION_WORKER_RESULT_MISSING',
    502,
    'Worker framework did not return a bounded native task.run result',
  );
}

function parseWorkerResult(value: unknown): WorkerResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const profileId = typeof row.profileId === 'string' && row.profileId ? row.profileId : undefined;
  const rawResult =
    typeof row.result === 'string' && row.result.trim() ? row.result.trim() : undefined;
  if (!profileId || !rawResult) return null;
  return { profileId, result: bounded(rawResult, MAX_RESULT_BYTES, 'result') };
}

export function publicLease(lease: FederationLeaseRecord) {
  return {
    id: lease.id,
    source: {
      frameworkId: lease.sourceFrameworkId,
      boardId: lease.sourceBoardId,
      taskId: lease.sourceTaskId,
    },
    worker: {
      frameworkId: lease.workerFrameworkId,
      boardId: lease.workerBoardId,
      profileId: lease.workerProfileId,
      taskId: lease.workerTaskId,
    },
    status: lease.status,
    stage: lease.stage,
    attempt: lease.attempt,
    leaseExpiresAt: lease.leaseExpiresAt.toISOString(),
    heartbeatAt: lease.heartbeatAt.toISOString(),
    createdAt: lease.createdAt.toISOString(),
    updatedAt: lease.updatedAt.toISOString(),
  };
}
