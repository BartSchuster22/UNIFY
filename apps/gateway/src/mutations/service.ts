import type {
  HermesConversationOperation,
  HermesModelManagementOperation,
  HermesProfileOperation,
  HermesWorkOperation,
} from '@aquiero/contracts';
import { redactEvidence } from '../governance/canonical.js';
import { GovernanceError } from '../governance/service.js';
import type { GovernanceService } from '../governance/service.js';
import type { OperationRecord } from '../governance/types.js';
import type { HermesGatewayService } from '../hermes-control/service.js';
import {
  conversationMutationDefinitions,
  frameworkReconcileDefinition,
  modelMutationDefinitions,
  profileMutationDefinitions,
  workMutationDefinitions,
  type MutationDefinition,
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
    private readonly hermes: HermesGatewayService,
  ) {}

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
    if (operationType === 'framework.reconcile') validateFrameworkCommand(input);
    else if (operationType.startsWith('profile.')) validateProfileCommand(input, definition);
    else if (operationType.startsWith('model.') || operationType.startsWith('provider.'))
      validateModelCommand(input, definition);
    else if (operationType.startsWith('work.')) validateWorkCommand(input, definition);
    else validateConversationCommand(input, definition);
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
      payload: redactEvidence(input),
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
      const ownerResult = await this.executeHermes(input, {
        actorUserId,
        operationId,
        idempotencyKey: claim.operation.idempotencyKey,
      });
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
    const work = workMutationDefinitions[operationType];
    if (work) return work;
    const profile = profileMutationDefinitions[operationType];
    if (profile) return profile;
    const model = modelMutationDefinitions[operationType];
    if (model) return model;
    const conversation = conversationMutationDefinitions[operationType];
    if (conversation) return conversation;
    throw new GovernanceError('MUTATION_UNSUPPORTED', 422, 'Mutation type is not supported');
  }

  private executeHermes(
    input: MutationInput,
    context: { actorUserId: string; operationId: string; idempotencyKey: string },
  ) {
    if (input.operationType === 'framework.reconcile')
      return this.hermes.reconcile(
        input.target.frameworkId!,
        {
          mode: input.mode,
          families: input.payload.families,
          expectedSourceVersion: input.payload.expectedSourceVersion,
        },
        context,
      );
    if (input.operationType.startsWith('profile.'))
      return this.hermes.profileManagement(
        input.target.frameworkId!,
        input.operationType as HermesProfileOperation,
        input.target.nativeId,
        input.payload,
        input.mode,
        context,
      );
    if (input.operationType.startsWith('work.'))
      return this.hermes.work(
        input.target.frameworkId!,
        input.operationType.slice('work.'.length) as HermesWorkOperation,
        input.target.nativeId,
        input.payload,
        input.mode,
        context,
      );
    if (input.operationType.startsWith('model.') || input.operationType.startsWith('provider.'))
      return this.hermes.modelManagement(
        input.target.frameworkId!,
        input.operationType as HermesModelManagementOperation,
        input.target.nativeId,
        input.payload,
        input.mode,
        context,
      );
    return this.hermes.conversation(
      input.target.frameworkId!,
      input.operationType.slice('conversation.'.length) as HermesConversationOperation,
      input.target.nativeId,
      input.payload,
      input.mode,
      context,
    );
  }

  private parseTarget(value: unknown): MutationTarget {
    const raw = record(value, 'target');
    const owner = requiredString(raw.owner, 'target.owner');
    if (owner !== 'hermes')
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

function validateProfileCommand(input: MutationInput, definition: MutationDefinition) {
  if (
    input.target.owner !== 'hermes' ||
    input.target.kind !== definition.kind ||
    !input.target.frameworkId
  )
    throw new GovernanceError(
      'MUTATION_TARGET_INVALID',
      422,
      'Profile rename must target one exact profile in one registered Hermes framework',
    );
  if (definition.destructive && !input.confirmed)
    throw new GovernanceError(
      'CONFIRMATION_REQUIRED',
      409,
      'Profile rename requires explicit confirmation',
    );
  const newId = input.payload.newId;
  if (
    typeof newId !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(newId) ||
    newId === input.target.nativeId
  )
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      'newId must be a distinct valid Hermes profile id',
    );
  const expectedSourceVersion = input.payload.expectedSourceVersion;
  if (typeof expectedSourceVersion !== 'string' || !expectedSourceVersion.trim())
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      'expectedSourceVersion is required for profile rename',
    );
}

function validateModelCommand(input: MutationInput, definition: MutationDefinition) {
  if (
    input.target.owner !== 'hermes' ||
    input.target.kind !== definition.kind ||
    !input.target.frameworkId
  )
    throw new GovernanceError(
      'MUTATION_TARGET_INVALID',
      422,
      'Model management must target one exact model or provider in one Hermes framework',
    );
  if (definition.destructive && !input.confirmed)
    throw new GovernanceError(
      'CONFIRMATION_REQUIRED',
      409,
      'Credential removal requires confirmation',
    );
  if (input.operationType === 'model.select') {
    const providerId = input.payload.providerId;
    if (typeof providerId !== 'string' || !providerId.trim())
      throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'providerId is required');
    const confirmation = input.payload.confirmExpensiveModel;
    if (confirmation !== undefined && typeof confirmation !== 'boolean')
      throw new GovernanceError(
        'MUTATION_PAYLOAD_INVALID',
        422,
        'confirmExpensiveModel must be a boolean',
      );
  }
  if (input.operationType === 'provider.credential.set') {
    const credential = input.payload.credential;
    if (typeof credential !== 'string' || !credential.trim() || credential.length > 32_768)
      throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'credential is required');
  }
  if (input.operationType === 'provider.validate' && input.payload.setup !== undefined) {
    const setup = input.payload.setup;
    if (!setup || typeof setup !== 'object' || Array.isArray(setup))
      throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'setup must be an object');
    const allowed = new Set(['profile', 'region', 'credentials', 'project', 'command']);
    for (const [key, value] of Object.entries(setup as Record<string, unknown>)) {
      if (
        !allowed.has(key) ||
        typeof value !== 'string' ||
        value.length > 4096 ||
        Array.from(value).some((character) => character.charCodeAt(0) < 32)
      )
        throw new GovernanceError(
          'MUTATION_PAYLOAD_INVALID',
          422,
          'provider identity setup contains an invalid field',
        );
    }
  }
  if (input.operationType === 'provider.inference.test') {
    const modelId = input.payload.modelId;
    if (typeof modelId !== 'string' || !modelId.trim())
      throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'modelId is required');
  }
  if (input.operationType === 'provider.oauth.status') {
    const sessionId = input.payload.sessionId;
    if (
      sessionId !== undefined &&
      (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256)
    )
      throw new GovernanceError(
        'MUTATION_PAYLOAD_INVALID',
        422,
        'sessionId must be a non-empty string',
      );
  }
  const expectedSourceVersion = input.payload.expectedSourceVersion;
  if (
    expectedSourceVersion !== undefined &&
    (typeof expectedSourceVersion !== 'string' || !expectedSourceVersion.trim())
  )
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      'expectedSourceVersion must be a non-empty string',
    );
}

function validateWorkCommand(input: MutationInput, definition: MutationDefinition) {
  if (
    input.target.owner !== 'hermes' ||
    input.target.kind !== definition.kind ||
    !input.target.frameworkId
  )
    throw new GovernanceError(
      'MUTATION_TARGET_INVALID',
      422,
      'Work mutation must target its exact resource in one registered Hermes framework',
    );
  if (definition.destructive && !input.confirmed)
    throw new GovernanceError(
      'CONFIRMATION_REQUIRED',
      409,
      'Destructive work mutation requires confirmation',
    );
  const required: Record<string, string[]> = {
    'work.project.create': ['name'],
    'work.project.rename': ['name'],
    'work.task.create': ['boardId', 'title'],
    'work.task.start': ['boardId'],
    'work.task.block': ['boardId'],
    'work.task.unblock': ['boardId'],
    'work.task.complete': ['boardId'],
    'work.cron.create': ['name', 'schedule', 'prompt'],
  };
  for (const field of required[input.operationType] ?? []) {
    const value = input.payload[field];
    if (typeof value !== 'string' || !value.trim())
      throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, `${field} is required`);
  }
  if (
    input.operationType === 'work.project.create' &&
    input.payload.startPmPlanning === true &&
    (typeof input.payload.projectManager !== 'string' || !input.payload.projectManager.trim())
  )
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      'projectManager is required when starting PM planning',
    );
  validateExpectedSourceVersion(input.payload.expectedSourceVersion);
}

function validateConversationCommand(input: MutationInput, definition: MutationDefinition) {
  if (
    input.target.owner !== 'hermes' ||
    input.target.kind !== definition.kind ||
    !input.target.frameworkId
  )
    throw new GovernanceError(
      'MUTATION_TARGET_INVALID',
      422,
      'Conversation mutation must target one exact session in one registered Hermes framework',
    );
  if (input.operationType === 'conversation.session.create') {
    const title = input.payload.title;
    if (typeof title !== 'string' || !title.trim() || title.length > 500)
      throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'title is required');
  } else validateConversationMessage(input.payload.message);
  validateExpectedSourceVersion(input.payload.expectedSourceVersion);
}

function validateConversationMessage(message: unknown) {
  if (typeof message === 'string' && message.trim() && message.length <= 1_000_000) return;
  if (!Array.isArray(message) || message.length === 0 || message.length > 10)
    throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'message is required');
  let useful = false;
  for (const value of message) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'message block is invalid');
    const block = value as Record<string, unknown>;
    if (block.type === 'text') {
      if (typeof block.text !== 'string' || !block.text.trim() || block.text.length > 1_000_000)
        throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'text block is invalid');
      useful = true;
      continue;
    }
    if (block.type === 'image_url') {
      const image = block.image_url;
      const url =
        image && typeof image === 'object' && !Array.isArray(image)
          ? (image as Record<string, unknown>).url
          : undefined;
      if (
        typeof url !== 'string' ||
        !/^data:image\/(?:png|jpeg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(url) ||
        url.length > 2_100_000
      )
        throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'image block is invalid');
      useful = true;
      continue;
    }
    throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'message block type is unsupported');
  }
  if (!useful) throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'message is required');
}

function validateExpectedSourceVersion(value: unknown) {
  if (value !== undefined && (typeof value !== 'string' || !value.trim()))
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      'expectedSourceVersion must be a non-empty string',
    );
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
