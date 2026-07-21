import { redactEvidence } from '../governance/canonical.js';
import { GovernanceError } from '../governance/service.js';
import type { GovernanceService } from '../governance/service.js';
import type { OperationRecord } from '../governance/types.js';
import type { HermesGatewayService } from '../hermes-control/service.js';
import {
  frameworkReconcileDefinition,
  type LegacyMutationOwnerClient,
  type MutationInput,
  type MutationTarget,
} from './types.js';

export type MutationResult = {
  replayed: boolean;
  operation: OperationRecord;
  result: unknown;
};

export class MutationService {
  constructor(
    private readonly governance: GovernanceService,
    private readonly legacyOwners?: LegacyMutationOwnerClient,
    private readonly hermes?: HermesGatewayService,
  ) {}

  get owners(): LegacyMutationOwnerClient {
    if (!this.legacyOwners)
      throw new GovernanceError(
        'LEGACY_MIGRATION_DISABLED',
        503,
        'Legacy migration readers are disabled',
      );
    return this.legacyOwners;
  }

  parse(value: unknown): MutationInput {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new GovernanceError('MUTATION_INVALID', 400, 'Mutation body must be an object');
    const raw = value as Record<string, unknown>;
    const operationType = requiredString(raw.operationType, 'operationType');
    const target = this.parseTarget(raw.target);
    const payload = raw.payload === undefined ? {} : record(raw.payload, 'payload');
    const mode = raw.mode === undefined ? 'execute' : raw.mode;
    if (mode !== 'validate' && mode !== 'dry-run' && mode !== 'execute')
      throw new GovernanceError(
        'MUTATION_MODE_INVALID',
        422,
        'mode must be validate, dry-run, or execute',
      );
    const input: MutationInput = {
      operationType,
      target,
      payload,
      mode,
      confirmed: raw.confirmed === true,
    };
    const definition = this.definition(operationType);
    if (definition.executionPath === 'hermes-control') validateFrameworkCommand(input);
    else this.owners.validate(input);
    return input;
  }

  permission(input: MutationInput): string {
    return this.definition(input.operationType).permission;
  }

  async run(
    actorUserId: string,
    idempotencyKey: string | undefined,
    input: MutationInput,
  ): Promise<MutationResult> {
    const claim = await this.governance.begin({
      actorUserId,
      action: input.operationType,
      targetFramework: input.target.frameworkId ?? input.target.owner,
      targetKind: input.target.kind,
      targetId: input.target.nativeId,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      mode: input.mode,
      policyDecision: 'allowed',
      payload: input,
    });
    if (claim.kind === 'replayed') {
      return { replayed: true, operation: claim.operation, result: claim.operation.result };
    }

    const operationId = claim.operation.id;
    try {
      await this.governance.transition(operationId, 'validated');
      await this.governance.transition(operationId, 'preflighted');
      await this.governance.evidence(operationId, 'mutation.preflight', {
        operationType: input.operationType,
        target: input.target,
        mode: input.mode,
        confirmed: input.confirmed,
      });
      await this.governance.transition(operationId, 'executing');
      const definition = this.definition(input.operationType);
      const ownerResult =
        definition.executionPath === 'hermes-control'
          ? await this.executeFramework(input, {
              actorUserId,
              operationId,
              idempotencyKey: claim.operation.idempotencyKey,
            })
          : await this.owners.execute(input);
      const safeResult = redactEvidence(ownerResult);
      await this.governance.transition(operationId, 'applied', safeResult);
      await this.governance.transition(operationId, 'verifying');
      const verified = await this.governance.transition(operationId, 'verified', safeResult);
      await this.governance.evidence(operationId, 'mutation.owner-result', safeResult);
      await this.governance.audit({
        actorUserId,
        action: input.operationType,
        target: input.target,
        outcome: 'success',
        details: { operationId, mode: input.mode },
      });
      return { replayed: false, operation: verified, result: safeResult };
    } catch (error) {
      const current = await this.current(operationId);
      if (
        current &&
        [
          'pending',
          'validated',
          'preflighted',
          'awaiting_confirmation',
          'executing',
          'applied',
          'verifying',
          'inconclusive',
        ].includes(current.state)
      ) {
        try {
          await this.governance.transition(operationId, 'failed', undefined, {
            code: error instanceof GovernanceError ? error.code : 'MUTATION_FAILED',
          });
        } catch {
          // The original error and immutable audit event remain authoritative.
        }
      }
      await this.governance.audit({
        actorUserId,
        action: input.operationType,
        target: input.target,
        outcome: 'failure',
        details: {
          operationId,
          code: error instanceof GovernanceError ? error.code : 'MUTATION_FAILED',
        },
      });
      throw error;
    }
  }

  private current(operationId: string): Promise<OperationRecord | null> {
    return this.governance.getOperation(operationId);
  }

  private definition(operationType: string) {
    if (operationType === 'framework.reconcile') return frameworkReconcileDefinition;
    return this.owners.definition(operationType);
  }

  private executeFramework(
    input: MutationInput,
    context: { actorUserId: string; operationId: string; idempotencyKey: string },
  ) {
    if (!this.hermes)
      throw new GovernanceError(
        'HERMES_CONTROL_UNAVAILABLE',
        503,
        'Hermes control client is unavailable',
      );
    return this.hermes.reconcile(
      input.target.frameworkId!,
      {
        mode: input.mode,
        families: input.payload.families,
        expectedSourceVersion: input.payload.expectedSourceVersion,
      },
      context,
    );
  }

  private parseTarget(value: unknown): MutationTarget {
    const raw = record(value, 'target');
    const owner = requiredString(raw.owner, 'target.owner');
    if (!['hermes', 'dmm', 'worker', 'chat', 'memory-v4'].includes(owner))
      throw new GovernanceError('MUTATION_OWNER_INVALID', 422, 'target.owner is not supported');
    const target: MutationTarget = {
      owner: owner as MutationTarget['owner'],
      kind: requiredString(raw.kind, 'target.kind'),
      nativeId: requiredString(raw.nativeId, 'target.nativeId'),
    };
    if (raw.frameworkId !== undefined)
      target.frameworkId = requiredString(raw.frameworkId, 'target.frameworkId');
    return target;
  }
}

function validateFrameworkCommand(input: MutationInput) {
  const definition = frameworkReconcileDefinition;
  if (input.target.owner !== definition.owner || input.target.kind !== definition.kind)
    throw new GovernanceError(
      'MUTATION_TARGET_INVALID',
      422,
      'Mutation target does not match operation type',
    );
  if (!input.target.frameworkId || input.target.nativeId !== input.target.frameworkId)
    throw new GovernanceError(
      'FRAMEWORK_REQUIRED',
      422,
      'Framework command target must identify one exact framework',
    );
  if (input.payload.families !== undefined) {
    if (
      !Array.isArray(input.payload.families) ||
      input.payload.families.length === 0 ||
      input.payload.families.some(
        (family) => !['profiles', 'providers', 'work', 'conversations'].includes(String(family)),
      )
    )
      throw new GovernanceError(
        'MUTATION_PAYLOAD_INVALID',
        422,
        'families must contain only supported Hermes domain families',
      );
  }
  if (
    input.payload.expectedSourceVersion !== undefined &&
    (typeof input.payload.expectedSourceVersion !== 'string' ||
      !input.payload.expectedSourceVersion.trim())
  )
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      'expectedSourceVersion must be a non-empty string',
    );
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024)
    throw new GovernanceError('MUTATION_INVALID', 400, `${field} must be a non-empty string`);
  return value.trim();
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GovernanceError('MUTATION_INVALID', 400, `${field} must be an object`);
  return value as Record<string, unknown>;
}
