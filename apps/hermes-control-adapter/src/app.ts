import { AgentConfigurationError } from './agent-configuration.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import {
  HERMES_CONTROL_VERSION,
  HermesConversationCommandSchema,
  HermesControlCommandSchema,
  HermesModelManagementCommandSchema,
  HermesProfileCommandSchema,
  HermesWorkCommandSchema,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkScope,
  type HermesConversationCommand,
  type HermesControlCommand,
  type HermesModelManagementCommand,
  type HermesProfileCommand,
  type HermesWorkCommand,
} from '@aquiero/contracts';
import {
  ModelConfirmationRequiredError,
  SecondConsumerForbiddenError,
  sourceVersion,
  SourceConflictError,
  SourceUnavailableError,
} from './source.js';
import { IdempotencyBusyError, IdempotencyConflictError } from './event-store.js';
import type { AdapterEventStore, AdapterSource, CapabilityFamily } from './types.js';

import {ApplicationRuntime,validateApplicationRequest,type ApplicationAction} from './application-runtime.js';

export interface HermesControlAdapterOptions {
  applicationRuntime?: ApplicationRuntime;
  frameworkId: string;
  displayName: string;
  instanceId: string;
  bearerToken?: string;
  verifyBearerToken?: (token: string) => Promise<boolean>;
  https?: { readonly key: Buffer; readonly cert: Buffer };
  scopes: FrameworkScope[];
  source: AdapterSource;
  events: AdapterEventStore;
  upstreamBaseCommit?: string;
  pythonVersion: string;
  releaseId?: string;
  frameworkRelease?: string;
  frameworkCommit?: string;
}

class AdapterError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function buildHermesControlAdapter(options: HermesControlAdapterOptions) {
  if (!options.bearerToken && !options.verifyBearerToken)
    throw new Error('A bearer token or rotating bearer token verifier is required');
  let workQueue: Promise<void> = Promise.resolve();
  const serializeWork = <T>(operation: string, action: () => Promise<T>): Promise<T> => {
    if (!operation.startsWith('project.') && !operation.startsWith('profile.')) return action();
    const next = workQueue.then(action);
    workQueue = next.then(() => undefined, () => undefined);
    return next;
  };
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    ...(options.https ? { https: options.https } : {}),
  });
  const scopes = new Set(options.scopes);
  const auditedRequests = new WeakSet<object>();

  const auditCommand = async (
    request: FastifyRequest,
    outcome: 'success' | 'denied' | 'failure' | 'inconclusive',
    operationId: string | undefined,
    status: string,
  ) => {
    if (auditedRequests.has(request)) return;
    const body = commandAuditFields(request.body);
    await options.events.audit({
      frameworkId: options.frameworkId,
      eventType: request.url.startsWith('/control/v1/commands/profiles')
        ? 'hermes.adapter.command.profiles'
        : request.url.startsWith('/control/v1/commands/models')
          ? 'hermes.adapter.command.models'
          : request.url.startsWith('/control/v1/commands/work')
            ? 'hermes.adapter.command.work'
            : request.url.startsWith('/control/v1/commands/conversations')
              ? 'hermes.adapter.command.conversations'
              : 'hermes.adapter.command.reconcile',
      outcome,
      requestId: body.requestId ?? request.id,
      correlationId: body.correlationId ?? request.id,
      ...(body.actorType ? { actorType: body.actorType } : {}),
      ...(body.actorId ? { actorId: body.actorId } : {}),
      ...(operationId ? { operationId } : {}),
      safeMetadata: { status, mode: body.mode ?? 'invalid' },
    });
    auditedRequests.add(request);
  };

  const replayCommand = async (
    request: FastifyRequest,
    capability: string,
    command: { mode: string; idempotencyKey: string },
    requestHash: string,
  ): Promise<Record<string, unknown> | undefined> => {
    if (command.mode !== 'execute') return undefined;
    const prior = await options.events.replay(
      options.frameworkId,
      capability,
      command.idempotencyKey,
      requestHash,
    );
    if (!prior) return undefined;
    const response = structuredClone(prior.response);
    const data = response.data;
    let operationId: string | undefined;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const record = data as Record<string, unknown>;
      record.replayed = true;
      if (typeof record.operationId === 'string') operationId = record.operationId;
    }
    await auditCommand(request, 'success', operationId, 'replayed');
    return response;
  };

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/control/v1/')) return;
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    const authenticated = options.verifyBearerToken
      ? await options.verifyBearerToken(token)
      : constantTimeEqual(token, options.bearerToken ?? '');
    if (!authenticated) throw new AdapterError('unauthenticated', 401, 'Authentication required');
  });

  app.setErrorHandler(async (error, request, reply) => {
    let mapped = error instanceof AgentConfigurationError ? new AdapterError(error.conflict ? 'source_version_mismatch' : 'invalid_request', error.conflict ? 409 : 400, error.message) : mapError(error);
    if (request.url.startsWith('/control/v1/commands/')) {
      try {
        await auditCommand(
          request,
          mapped.statusCode === 401 || mapped.statusCode === 403 ? 'denied' : 'failure',
          undefined,
          mapped.code,
        );
      } catch {
        mapped = new AdapterError('internal_error', 500, 'Audit persistence unavailable', true);
      }
    }
    void reply.status(mapped.statusCode).send({
      contractVersion: HERMES_CONTROL_VERSION,
      frameworkId: options.frameworkId,
      error: {
        code: mapped.code,
        message: mapped.message,
        requestId: request.id,
        retryable: mapped.retryable,
      },
    });
  });

  app.get('/health', async (_request, reply) => {
    const checks = await options.source.health();
    const eventStore = (await options.events.ready()) ? 'healthy' : 'unavailable';
    const status = Object.values({ ...checks, eventStore }).includes('unavailable')
      ? 'degraded'
      : 'healthy';
    return reply
      .status(status === 'healthy' ? 200 : 503)
      .send({ status, checks: { ...checks, eventStore } });
  });

  if(options.applicationRuntime){
    const applicationEnvelope=(data:unknown)=>({contractVersion:'alica-native-application/v1',frameworkId:options.frameworkId,frameworkCommit:options.frameworkCommit??PINNED_HERMES_COMMIT,frameworkVersion:options.frameworkRelease??PINNED_HERMES_RELEASE,instanceId:options.instanceId,data});
    app.get('/control/v1/applications/capabilities',async()=>{if(!scopes.has('control:execute'))throw new AdapterError('forbidden',403,'Execution scope required');return applicationEnvelope({supported:true});});
    for(const action of ['execute','lookup','cancel','erase'] as ApplicationAction[]){
      app.post('/control/v1/applications/'+action,{bodyLimit:98304},async(request)=>{
        if(!scopes.has('control:execute'))throw new AdapterError('forbidden',403,'Execution scope required');
        try{validateApplicationRequest(action,request.body);}catch{throw new AdapterError('invalid_request',422,'Restricted application contract rejected');}
        const result=await options.applicationRuntime!.run(action,request.body);
        await options.events.audit({frameworkId:options.frameworkId,eventType:'hermes.adapter.application.'+action,outcome:'success',operationId:request.body.receiptId,requestId:request.id,correlationId:request.body.receiptId,safeMetadata:{state:result.state,applicationId:request.body.applicationId}});
        return applicationEnvelope(result);
      });
    }
  }

  app.get('/control/v1/identity', async () =>
    response(options, 'identity', {
      runtime: 'hermes-agent',
      instanceId: options.instanceId,
      displayName: options.displayName,
    }),
  );

  app.get('/control/v1/version', async () => {
    const commit = options.frameworkCommit ?? PINNED_HERMES_COMMIT;
    const release = options.frameworkRelease ?? PINNED_HERMES_RELEASE;
    return response(options, `git:${commit}`, {
      release,
      commit,
      ...(options.upstreamBaseCommit ? { upstreamBaseCommit: options.upstreamBaseCommit } : {}),
      dirty: false,
      pythonVersion: options.pythonVersion,
    });
  });

  app.get('/control/v1/health', async () => {
    requireScope(scopes, 'control:read');
    const checks = await options.source.health();
    const eventStore = (await options.events.ready()) ? 'healthy' : 'unavailable';
    const all = { ...checks, eventStore };
    const status = Object.values(all).includes('unavailable')
      ? 'unavailable'
      : Object.values(all).includes('degraded')
        ? 'degraded'
        : 'healthy';
    return response(options, sourceVersion(all), {
      status,
      checks: Object.fromEntries(
        Object.entries(all).map(([name, value]) => [name, { status: value }]),
      ),
    });
  });

  app.get('/control/v1/capabilities', async () => {
    requireScope(scopes, 'control:read');
    const conversations = options.source.conversationsConfigured();
    const modelManagement = options.source.modelManagementConfigured();
    return response(options, `adapter:${options.releaseId ?? 'development'}`, {
      capabilities: {
        'profiles.read': supported('control:read'),
        'providers.read': supported('control:read'),
        'models.read': supported('control:read'),
        'providers.credentials.status': supported('control:read'),
        'work.projects.read': supported('control:read'),
        'work.boards.read': supported('control:read'),
        'work.tasks.read': supported('control:read'),
        'work.cron.read': supported('control:read'),
        'conversations.sessions.read': conversations
          ? supported('control:read')
          : unavailable('HERMES_API_NOT_CONFIGURED'),
        'conversations.messages.read': conversations
          ? supported('control:read')
          : unavailable('HERMES_API_NOT_CONFIGURED'),
        'control.reconcile': {
          status: scopes.has('control:execute') ? 'supported' : 'forbidden',
          modes: scopes.has('control:execute') ? ['validate', 'dry-run', 'execute'] : [],
          requiredScopes: ['control:execute'],
          ...(!scopes.has('control:execute') ? { reasonCode: 'SCOPE_NOT_CONFIGURED' } : {}),
        },
        'profiles.configuration': options.source.agentConfiguration && options.source.validateAgentConfiguration ? { status: 'supported', modes: ['read','validate','dry-run','execute','verify'], requiredScopes: ['control:read','control:execute'] } : unsupported('AGENT_CONFIGURATION_UNAVAILABLE'),
        'profiles.execute': {
          status: scopes.has('control:execute') ? 'supported' : 'forbidden',
          modes: scopes.has('control:execute') ? ['validate', 'dry-run', 'execute', 'verify'] : [],
          requiredScopes: ['control:execute'],
          ...(!scopes.has('control:execute') ? { reasonCode: 'SCOPE_NOT_CONFIGURED' } : {}),
          constraints: { authority: 'hermes-native', optimisticConcurrency: true },
        },
        'providers.credentials.execute': modelManagement
          ? {
              status: scopes.has('control:secrets') ? 'supported' : 'forbidden',
              modes: scopes.has('control:secrets') ? ['validate', 'dry-run', 'execute'] : [],
              requiredScopes: ['control:secrets'],
              ...(!scopes.has('control:secrets') ? { reasonCode: 'SCOPE_NOT_CONFIGURED' } : {}),
              constraints: { authority: 'hermes-native', secretValuesReturned: false },
            }
          : unavailable('HERMES_MANAGEMENT_API_NOT_CONFIGURED'),
        'models.execute': modelManagement
          ? {
              status: scopes.has('control:execute') ? 'supported' : 'forbidden',
              modes: scopes.has('control:execute') ? ['validate', 'dry-run', 'execute'] : [],
              requiredScopes: ['control:execute'],
              ...(!scopes.has('control:execute') ? { reasonCode: 'SCOPE_NOT_CONFIGURED' } : {}),
              constraints: { authority: 'hermes-native', appliesToNewSessions: true },
            }
          : unavailable('HERMES_MANAGEMENT_API_NOT_CONFIGURED'),
        'work.execute': {
          status: scopes.has('control:execute') ? 'supported' : 'forbidden',
          modes: scopes.has('control:execute') ? ['validate', 'dry-run', 'execute'] : [],
          requiredScopes: ['control:execute'],
          ...(!scopes.has('control:execute') ? { reasonCode: 'SCOPE_NOT_CONFIGURED' } : {}),
          constraints: { authority: 'hermes-native', secondWriter: false },
        },
        'conversations.execute': conversations
          ? {
              status: scopes.has('control:execute') ? 'supported' : 'forbidden',
              modes: scopes.has('control:execute') ? ['validate', 'dry-run', 'execute'] : [],
              requiredScopes: ['control:execute'],
              ...(!scopes.has('control:execute') ? { reasonCode: 'SCOPE_NOT_CONFIGURED' } : {}),
              constraints: { authority: 'hermes-native', externalChannels: false },
            }
          : unavailable('HERMES_API_NOT_CONFIGURED'),
        'conversations.delivery.execute': unsupported('SECOND_CONSUMER_FORBIDDEN'),
      },
    });
  });

  app.get('/control/v1/profiles', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.profiles(), pageQuery(request.query));
  });

  app.get<{ Params: { profileId: string } }>('/control/v1/profiles/:profileId/configuration', async (request) => {
    requireScope(scopes, 'control:read');
    if (!options.source.agentConfiguration) throw new AdapterError('source_unavailable',503,'Agent configuration unavailable');
    return collection(options, await options.source.agentConfiguration(request.params.profileId), { limit: 1 });
  });

  app.get('/control/v1/providers', async (request) => {
    requireScope(scopes, 'control:read');
    const query = request.query as Record<string, unknown>;
    return collection(
      options,
      await options.source.providers(query.refresh === 'true'),
      pageQuery(query),
    );
  });

  app.get('/control/v1/models', async (request) => {
    requireScope(scopes, 'control:read');
    const query = request.query as Record<string, unknown>;
    return collection(
      options,
      await options.source.models(query.refresh === 'true'),
      pageQuery(query),
    );
  });

  app.get('/control/v1/work/workspaces', async (request) => {
    requireScope(scopes, 'control:read');
    if (!options.source.workspaces) throw new AdapterError('source_unavailable', 503, 'Workspace inventory is unavailable');
    return collection(options, await options.source.workspaces(), pageQuery(request.query));
  });

  app.get('/control/v1/work/projects', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.projects(), pageQuery(request.query));
  });

  app.get('/control/v1/work/boards', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.boards(), pageQuery(request.query));
  });

  app.get<{ Params: { boardId: string } }>(
    '/control/v1/work/boards/:boardId/tasks',
    async (request) => {
      requireScope(scopes, 'control:read');
      return collection(
        options,
        await options.source.tasks(request.params.boardId),
        pageQuery(request.query),
      );
    },
  );

  app.get('/control/v1/work/cronjobs', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.cronjobs(), pageQuery(request.query));
  });

  app.get('/control/v1/conversations/sessions', async (request) => {
    requireScope(scopes, 'control:read');
    return collection(options, await options.source.sessions(), pageQuery(request.query));
  });

  app.get<{ Params: { sessionId: string } }>(
    '/control/v1/conversations/sessions/:sessionId/messages',
    async (request) => {
      requireScope(scopes, 'control:read');
      return collection(
        options,
        await options.source.messages(request.params.sessionId),
        pageQuery(request.query),
      );
    },
  );

  app.get('/control/v1/events', async (request) => {
    requireScope(scopes, 'control:events');
    const query = pageQuery(request.query);
    const after = parseEventCursor(query.cursor);
    const items = await options.events.list(options.frameworkId, after, query.limit + 1);
    const hasMore = items.length > query.limit;
    const page = items.slice(0, query.limit);
    const lastSequence = page.at(-1)?.sequence;
    return response(options, sourceVersion(page.map((event) => event.sourceVersion)), {
      items: page,
      page: {
        hasMore,
        ...(hasMore && lastSequence !== undefined ? { nextCursor: eventCursor(lastSequence) } : {}),
      },
    });
  });

  app.post<{ Body: HermesControlCommand }>(
    '/control/v1/commands/reconcile',
    { schema: { body: HermesControlCommandSchema } },
    async (request) => {
      requireScope(scopes, 'control:execute');
      const command = request.body;
      const replay = await replayCommand(
        request,
        'control.reconcile',
        command,
        sourceVersion(command),
      );
      if (replay) return replay;
      const families = reconcileFamilies(command.payload.families);
      const operationId = randomUUID();
      if (command.mode === 'validate') {
        const result = response(options, 'validation', {
          operationId,
          status: 'validated',
          replayed: false,
          observedFamilies: families,
          emittedEvents: 0,
        });
        await auditCommand(request, 'success', operationId, 'validated');
        return result;
      }

      const observed = await observeFamilies(options.source, families);
      const aggregateVersion = sourceVersion(
        observed.map(({ family, sourceVersion: version }) => [family, version]),
      );
      if (command.expectedSourceVersion && command.expectedSourceVersion !== aggregateVersion)
        throw new AdapterError(
          'source_version_mismatch',
          409,
          'Expected source version does not match current Hermes observations',
        );
      const result = response(options, aggregateVersion, {
        operationId,
        status: command.mode === 'dry-run' ? 'dry-run' : 'completed',
        replayed: false,
        observedFamilies: families,
        emittedEvents: 0,
      });
      if (command.mode === 'dry-run') {
        await auditCommand(request, 'success', operationId, 'dry-run');
        return result;
      }

      const committed = await options.events.commit({
        frameworkId: options.frameworkId,
        capability: 'control.reconcile',
        idempotencyKey: command.idempotencyKey,
        requestHash: sourceVersion(command),
        command,
        response: result,
        events: observed.map((item) => ({
          family: item.family,
          type: `${item.family}.snapshot.observed`,
          sourceVersion: item.sourceVersion,
          correlationId: command.correlationId,
          operationId,
          payload: { itemCount: item.count },
        })),
      });
      if (committed.replayed) {
        const data = committed.response.data;
        if (data && typeof data === 'object' && !Array.isArray(data))
          (data as Record<string, unknown>).replayed = true;
      }
      await auditCommand(
        request,
        'success',
        operationId,
        committed.replayed ? 'replayed' : 'completed',
      );
      return committed.response;
    },
  );

  app.post<{ Body: HermesProfileCommand }>(
    '/control/v1/commands/profiles',
    { schema: { body: HermesProfileCommandSchema } },
    async (request) => {
      requireScope(scopes, 'control:execute');
      const command = request.body;
      return serializeWork(command.operation, async () => {
      const renameTargetId = validateProfilePayload(command);
      const replay = await replayCommand(
        request,
        'profiles.execute',
        command,
        sourceVersion(command),
      );
      if (replay) return replay;
      const before = await options.source.profiles();
      if (command.expectedSourceVersion && command.expectedSourceVersion !== before.sourceVersion)
        throw new AdapterError(
          'source_version_mismatch',
          409,
          'Expected source version does not match current Hermes profiles',
        );
      if (command.payload.configuration !== undefined && !options.source.validateAgentConfiguration) throw new AdapterError('source_unavailable',503,'Agent configuration edits are unavailable');
      await options.source.validateAgentConfiguration?.(command);
      if (command.payload.configuration && command.operation === 'profile.create' && before.items.some(item => item.id === command.targetId)) throw new AdapterError('source_version_mismatch',409,'Agent ID already exists');
      const operationId = randomUUID();
      if (command.mode !== 'execute') {
        const status = command.mode === 'validate' ? 'validated' : 'dry-run';
        const result = response(options, before.sourceVersion, {
          operationId,
          status,
          replayed: false,
          operation: command.operation,
          targetId: command.targetId,
          result: {
            exists: before.items.some((item) => item.id === command.targetId),
            ...(renameTargetId
              ? { destinationExists: before.items.some((item) => item.id === renameTargetId) }
              : {}),
          },
          emittedEvents: 0,
        });
        await auditCommand(request, 'success', operationId, status);
        return result;
      }
      const ownerResult = await options.source.executeProfile(command);
      const after = await options.source.profiles();
      verifyProfileResult(command, after.items, renameTargetId);
      const result = response(options, after.sourceVersion, {
        operationId,
        status: 'completed',
        replayed: false,
        operation: command.operation,
        targetId: command.targetId,
        result: ownerResult,
        emittedEvents: 0,
      });
      const committed = await options.events.commit({
        frameworkId: options.frameworkId,
        capability: 'profiles.execute',
        idempotencyKey: command.idempotencyKey,
        requestHash: sourceVersion(command),
        command,
        response: result,
        events: [
          {
            family: 'profiles',
            type: command.operation,
            sourceVersion: after.sourceVersion,
            correlationId: command.correlationId,
            operationId,
            payload: {
              targetId: command.targetId,
              ...(renameTargetId ? { newId: renameTargetId } : {}),
            },
          },
        ],
      });
      if (committed.replayed) {
        const data = committed.response.data;
        if (data && typeof data === 'object' && !Array.isArray(data))
          (data as Record<string, unknown>).replayed = true;
      }
      await auditCommand(
        request,
        'success',
        operationId,
        committed.replayed ? 'replayed' : 'completed',
      );
      return committed.response;
      });
    },
  );

  app.post<{ Body: HermesModelManagementCommand }>(
    '/control/v1/commands/models',
    { schema: { body: HermesModelManagementCommandSchema } },
    async (request) => {
      const command = request.body;
      const providerStateOperation =
        command.operation.startsWith('provider.credential.') ||
        command.operation.startsWith('provider.oauth.') ||
        command.operation === 'provider.validate' ||
        command.operation === 'provider.persistence.verify';
      requireScope(
        scopes,
        command.operation.startsWith('provider.credential.') ||
          command.operation.startsWith('provider.oauth.')
          ? 'control:secrets'
          : 'control:execute',
      );
      validateModelManagementPayload(command);
      const ownerCapability =
        command.operation.startsWith('provider.credential.') ||
        command.operation.startsWith('provider.oauth.')
          ? 'providers.credentials.execute'
          : 'models.execute';
      const replay = await replayCommand(
        request,
        ownerCapability,
        command,
        sourceVersion(safeModelManagementCommand(command)),
      );
      if (replay) return replay;
      const before = providerStateOperation
        ? await options.source.providers()
        : await options.source.models();
      if (command.expectedSourceVersion && command.expectedSourceVersion !== before.sourceVersion)
        throw new AdapterError(
          'source_version_mismatch',
          409,
          'Expected source version does not match current Hermes model configuration',
        );
      const operationId = randomUUID();
      if (command.mode !== 'execute') {
        const status = command.mode === 'validate' ? 'validated' : 'dry-run';
        const result = response(options, before.sourceVersion, {
          operationId,
          status,
          replayed: false,
          operation: command.operation,
          targetId: command.targetId,
          result: {},
          emittedEvents: 0,
        });
        await auditCommand(request, 'success', operationId, status);
        return result;
      }
      const ownerResult = await options.source.executeModelManagement(command);
      const after = providerStateOperation
        ? await options.source.providers()
        : await options.source.models();
      verifyModelManagementResult(command, after.items, ownerResult);
      const result = response(options, after.sourceVersion, {
        operationId,
        status: 'completed',
        replayed: false,
        operation: command.operation,
        targetId: command.targetId,
        result: ownerResult,
        emittedEvents: 0,
      });
      const committed = await options.events.commit({
        frameworkId: options.frameworkId,
        capability: ownerCapability,
        idempotencyKey: command.idempotencyKey,
        requestHash: sourceVersion(safeModelManagementCommand(command)),
        command: safeModelManagementCommand(command),
        response: result,
        events: [
          {
            family: command.operation.startsWith('provider.') ? 'providers' : 'models',
            type: command.operation,
            sourceVersion: after.sourceVersion,
            correlationId: command.correlationId,
            operationId,
            payload: { targetId: command.targetId },
          },
        ],
      });
      if (committed.replayed) {
        const data = committed.response.data;
        if (data && typeof data === 'object' && !Array.isArray(data))
          (data as Record<string, unknown>).replayed = true;
      }
      await auditCommand(
        request,
        'success',
        operationId,
        committed.replayed ? 'replayed' : 'completed',
      );
      return committed.response;
    },
  );

  app.post<{ Body: HermesWorkCommand }>(
    '/control/v1/commands/work',
    { schema: { body: HermesWorkCommandSchema } },
    async (request) => serializeWork(request.body.operation, async () => {
      requireScope(scopes, 'control:execute');
      const command = request.body;
      validateWorkPayload(command);
      const replay = await replayCommand(request, 'work.execute', command, sourceVersion(command));
      if (replay) return replay;
      try { await options.source.validateWorkSelections?.(command); } catch {
        throw new AdapterError('invalid_request', 400, 'Workspace or agent selection is invalid or unavailable in this framework');
      }
      const beforeVersion = await workSourceVersion(options.source, command);
      if (command.expectedSourceVersion && command.expectedSourceVersion !== beforeVersion)
        throw new AdapterError(
          'source_version_mismatch',
          409,
          'Expected source version does not match current Hermes work state',
        );
      const operationId = randomUUID();
      if (command.mode !== 'execute') {
        const status = command.mode === 'validate' ? 'validated' : 'dry-run';
        const result = response(options, sourceVersion(command), {
          operationId,
          status,
          replayed: false,
          operation: command.operation,
          targetId: command.targetId,
          result: {},
          emittedEvents: 0,
        });
        await auditCommand(request, 'success', operationId, status);
        return result;
      }
      const ownerResult = await options.source.executeWork(command);
      const version = sourceVersion(ownerResult);
      const result = response(options, version, {
        operationId,
        status: 'completed',
        replayed: false,
        operation: command.operation,
        targetId: command.targetId,
        result: ownerResult,
        emittedEvents: 0,
      });
      const committed = await options.events.commit({
        frameworkId: options.frameworkId,
        capability: 'work.execute',
        idempotencyKey: command.idempotencyKey,
        requestHash: sourceVersion(command),
        command,
        response: result,
        events: [
          {
            family: 'work',
            type: `work.${command.operation}`,
            sourceVersion: version,
            correlationId: command.correlationId,
            operationId,
            payload: { targetId: command.targetId },
          },
        ],
      });
      if (committed.replayed) {
        const data = committed.response.data;
        if (data && typeof data === 'object' && !Array.isArray(data))
          (data as Record<string, unknown>).replayed = true;
      }
      await auditCommand(
        request,
        'success',
        operationId,
        committed.replayed ? 'replayed' : 'completed',
      );
      return committed.response;
    }),
  );

  app.post<{ Body: HermesConversationCommand }>(
    '/control/v1/commands/conversations',
    { schema: { body: HermesConversationCommandSchema } },
    async (request) => {
      requireScope(scopes, 'control:execute');
      const command = request.body;
      validateConversationPayload(command);
      const replay = await replayCommand(
        request,
        'conversations.execute',
        command,
        sourceVersion(command),
      );
      if (replay) return replay;
      const beforeVersion =
        command.operation === 'session.create'
          ? (await options.source.sessions()).sourceVersion
          : (await options.source.messages(command.targetId)).sourceVersion;
      if (command.expectedSourceVersion && command.expectedSourceVersion !== beforeVersion)
        throw new AdapterError(
          'source_version_mismatch',
          409,
          'Expected source version does not match current Hermes conversation state',
        );
      const operationId = randomUUID();
      if (command.mode !== 'execute') {
        const status = command.mode === 'validate' ? 'validated' : 'dry-run';
        const result = response(options, sourceVersion(command), {
          operationId,
          status,
          replayed: false,
          operation: command.operation,
          targetId: command.targetId,
          result: {},
          emittedEvents: 0,
        });
        await auditCommand(request, 'success', operationId, status);
        return result;
      }
      const ownerResult = await options.source.executeConversation(command);
      const version = sourceVersion(ownerResult);
      const result = response(options, version, {
        operationId,
        status: 'completed',
        replayed: false,
        operation: command.operation,
        targetId: command.targetId,
        result: ownerResult,
        emittedEvents: 0,
      });
      const committed = await options.events.commit({
        frameworkId: options.frameworkId,
        capability: 'conversations.execute',
        idempotencyKey: command.idempotencyKey,
        requestHash: sourceVersion(command),
        command,
        response: result,
        events: [
          {
            family: 'conversations',
            type: `conversations.${command.operation}`,
            sourceVersion: version,
            correlationId: command.correlationId,
            operationId,
            payload: { targetId: command.targetId },
          },
        ],
      });
      if (committed.replayed) {
        const data = committed.response.data;
        if (data && typeof data === 'object' && !Array.isArray(data))
          (data as Record<string, unknown>).replayed = true;
      }
      await auditCommand(
        request,
        'success',
        operationId,
        committed.replayed ? 'replayed' : 'completed',
      );
      return committed.response;
    },
  );

  return app;
}

function validateProfilePayload(command: HermesProfileCommand): string | undefined {
  if (command.operation !== 'profile.rename') return undefined;
  const newId = command.payload.newId;
  if (
    typeof newId !== 'string' ||
    !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(newId) ||
    newId === command.targetId
  )
    throw new AdapterError(
      'invalid_request',
      400,
      'Profile rename requires a distinct valid newId',
    );
  return newId;
}

function verifyProfileResult(
  command: HermesProfileCommand,
  profiles: Array<{ id: string }>,
  renameTargetId?: string,
) {
  const sourceExists = profiles.some((item) => item.id === command.targetId);
  if (command.operation === 'profile.rename') {
    const destinationExists = profiles.some((item) => item.id === renameTargetId);
    if (!sourceExists && destinationExists) return;
  } else {
    const shouldExist = command.operation !== 'profile.delete';
    if (sourceExists === shouldExist) return;
  }
  throw new AdapterError(
    'internal_error',
    502,
    'Hermes profile mutation could not be verified by authoritative readback',
    true,
  );
}

function verifyModelManagementResult(
  command: HermesModelManagementCommand,
  items: Array<{
    id: string;
    credentialStatus?: 'configured' | 'missing' | 'unknown';
    providerId?: string;
    selected?: boolean;
  }>,
  result: Record<string, unknown>,
) {
  if (
    command.operation === 'provider.models.refresh' ||
    command.operation === 'provider.inference.test'
  ) {
    if (
      (command.operation === 'provider.models.refresh' && Number(result.discovered) > 0) ||
      (command.operation === 'provider.inference.test' && result.succeeded === true)
    )
      return;
  } else if (command.operation === 'provider.validate') {
    if (
      result.accepted === true &&
      (result.verified === true ||
        (result.identityKind === 'external_cli' &&
          result.prerequisites !== null &&
          typeof result.prerequisites === 'object'))
    )
      return;
  } else if (command.operation === 'provider.persistence.verify') {
    if (result.configured === true && result.persisted === true) return;
  } else if (
    command.operation === 'provider.oauth.start' ||
    command.operation === 'provider.oauth.reconnect'
  ) {
    if (
      typeof result.session_id === 'string' &&
      result.session_id.length > 0 &&
      typeof result.user_code === 'string' &&
      result.user_code.length > 0 &&
      typeof result.verification_url === 'string' &&
      result.verification_url.length > 0 &&
      result.status === 'pending'
    )
      return;
  } else if (command.operation === 'provider.oauth.status') {
    if (
      ['pending', 'approved', 'denied', 'expired', 'error', 'connected', 'disconnected'].includes(
        String(result.status),
      ) ||
      typeof result.authenticated === 'boolean'
    )
      return;
  } else if (command.operation === 'provider.oauth.disconnect') {
    const provider = items.find((item) => item.id === command.targetId);
    if (provider?.credentialStatus !== 'configured' && result.disconnected === true) return;
  } else if (command.operation === 'model.select') {
    const selected = items.some(
      (item) =>
        item.id === command.targetId &&
        item.providerId === command.payload.providerId &&
        item.selected === true,
    );
    if (selected) return;
  } else {
    const provider = items.find((item) => item.id === command.targetId);
    if (
      provider &&
      (command.operation === 'provider.credential.set'
        ? provider.credentialStatus === 'configured'
        : provider.credentialStatus !== 'configured')
    )
      return;
  }
  throw new AdapterError(
    'internal_error',
    502,
    'Hermes model-management mutation could not be verified by authoritative readback',
    true,
  );
}

function validateModelManagementPayload(command: HermesModelManagementCommand) {
  if (command.operation === 'model.select') {
    const providerId = command.payload.providerId;
    if (typeof providerId !== 'string' || !providerId.trim())
      throw new AdapterError('invalid_request', 400, 'Provider id is required');
    return;
  }
  if (command.operation === 'provider.credential.set') {
    const credential = command.payload.credential;
    if (typeof credential !== 'string' || !credential.trim() || credential.length > 32_768)
      throw new AdapterError('invalid_request', 400, 'Credential is required');
  }
  if (command.operation === 'provider.oauth.status' && command.payload.sessionId !== undefined) {
    const sessionId = command.payload.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 256)
      throw new AdapterError('invalid_request', 400, 'OAuth session id is invalid');
  }
}

function safeModelManagementCommand(
  command: HermesModelManagementCommand,
): HermesModelManagementCommand {
  if (command.operation !== 'provider.credential.set') return command;
  return { ...command, payload: { ...command.payload, credential: '[REDACTED]' } };
}

function validateConversationPayload(command: HermesConversationCommand) {
  if (command.operation === 'session.create') {
    const title = command.payload.title;
    if (typeof title !== 'string' || !title.trim())
      throw new AdapterError('invalid_request', 400, 'Session title is required');
    return;
  }
  const message = command.payload.message;
  if (
    (typeof message !== 'string' || !message.trim()) &&
    (!Array.isArray(message) || message.length === 0)
  )
    throw new AdapterError('invalid_request', 400, 'Conversation message is required');
}

function validateWorkPayload(command: HermesWorkCommand) {
  const required: Partial<Record<HermesWorkCommand['operation'], string[]>> = {
    'project.create': ['name'],
    'project.rename': ['name'],
    'project.configure': ['name'],
    'task.create': ['boardId', 'title'],
    'task.start': ['boardId'],
    'task.block': ['boardId'],
    'task.unblock': ['boardId'],
    'task.complete': ['boardId'],
    'task.run': ['profileId', 'prompt'],
    'cron.create': ['name', 'schedule', 'prompt'],
  };
  const missing = (required[command.operation] ?? []).find((key) => {
    const value = command.payload[key];
    return typeof value !== 'string' || !value.trim();
  });
  if (missing)
    throw new AdapterError('invalid_request', 400, `Work payload ${missing} is required`);
  if (
    command.operation === 'project.create' &&
    command.payload.startPmPlanning === true &&
    (typeof command.payload.projectManager !== 'string' || !command.payload.projectManager.trim())
  )
    throw new AdapterError('invalid_request', 400, 'Project manager is required to start planning');
}

function workSourceVersion(source: AdapterSource, command: HermesWorkCommand): Promise<string> {
  if (command.operation === 'task.run')
    return source.profiles().then((snapshot) => snapshot.sourceVersion);
  if (command.operation.startsWith('project.'))
    return source.projects().then((snapshot) => snapshot.sourceVersion);
  if (command.operation.startsWith('cron.'))
    return source.cronjobs().then((snapshot) => snapshot.sourceVersion);
  const boardId = command.payload.boardId;
  if (typeof boardId !== 'string' || !boardId.trim())
    throw new AdapterError('invalid_request', 400, 'Work payload boardId is required');
  return source.tasks(boardId).then((snapshot) => snapshot.sourceVersion);
}

function response(options: HermesControlAdapterOptions, version: string, data: unknown) {
  return {
    contractVersion: HERMES_CONTROL_VERSION,
    frameworkId: options.frameworkId,
    frameworkVersion: options.frameworkRelease ?? PINNED_HERMES_RELEASE,
    frameworkCommit: options.frameworkCommit ?? PINNED_HERMES_COMMIT,
    sourceVersion: version,
    observedAt: new Date().toISOString(),
    data,
  };
}

function collection<T>(
  options: HermesControlAdapterOptions,
  snapshot: { items: T[]; sourceVersion: string },
  query: { cursor?: string; limit: number },
) {
  const offset = parseCollectionCursor(query.cursor, snapshot.sourceVersion);
  const items = snapshot.items.slice(offset, offset + query.limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < snapshot.items.length;
  return response(options, snapshot.sourceVersion, {
    items,
    page: {
      hasMore,
      ...(hasMore ? { nextCursor: collectionCursor(nextOffset, snapshot.sourceVersion) } : {}),
    },
  });
}

function pageQuery(value: unknown) {
  const query = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const rawLimit = Number(query.limit ?? 100);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const cursor = typeof query.cursor === 'string' && query.cursor ? query.cursor : undefined;
  return { limit, ...(cursor ? { cursor } : {}) };
}

function collectionCursor(offset: number, version: string) {
  return Buffer.from(JSON.stringify({ offset, version }), 'utf8').toString('base64url');
}

function parseCollectionCursor(cursor: string | undefined, version: string) {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (!Number.isInteger(parsed.offset) || Number(parsed.offset) < 0 || parsed.version !== version)
      throw new Error('invalid');
    return Number(parsed.offset);
  } catch {
    throw new AdapterError(
      'source_version_mismatch',
      409,
      'Cursor is invalid or belongs to another source version',
    );
  }
}

function eventCursor(sequence: number) {
  return Buffer.from(String(sequence), 'utf8').toString('base64url');
}

function parseEventCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(value) || value < 0)
    throw new AdapterError('invalid_request', 400, 'Event cursor is invalid');
  return value;
}

function supported(scope: FrameworkScope) {
  return { status: 'supported' as const, modes: ['read' as const], requiredScopes: [scope] };
}

function unsupported(reasonCode: string) {
  return { status: 'unsupported' as const, modes: [], requiredScopes: [], reasonCode };
}

function unavailable(reasonCode: string) {
  return {
    status: 'unavailable' as const,
    modes: ['read' as const],
    requiredScopes: ['control:read'],
    reasonCode,
  };
}

function requireScope(scopes: Set<FrameworkScope>, scope: FrameworkScope) {
  if (!scopes.has(scope)) throw new AdapterError('forbidden', 403, `Required scope is unavailable`);
}

function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reconcileFamilies(value: unknown): CapabilityFamily[] {
  if (value === undefined) return ['profiles', 'providers', 'work', 'conversations'];
  if (!Array.isArray(value) || value.length === 0)
    throw new AdapterError('invalid_request', 400, 'families must be a non-empty array');
  const allowed = new Set<CapabilityFamily>(['profiles', 'providers', 'work', 'conversations']);
  const result = [...new Set(value)];
  if (
    !result.every(
      (item): item is CapabilityFamily =>
        typeof item === 'string' && allowed.has(item as CapabilityFamily),
    )
  )
    throw new AdapterError('invalid_request', 400, 'families contains an unsupported value');
  return result;
}

async function observeFamilies(source: AdapterSource, families: CapabilityFamily[]) {
  const output: { family: CapabilityFamily; sourceVersion: string; count: number }[] = [];
  for (const family of families) {
    if (family === 'profiles') {
      const value = await source.profiles();
      output.push({ family, sourceVersion: value.sourceVersion, count: value.items.length });
    } else if (family === 'providers') {
      const value = await source.providers();
      output.push({ family, sourceVersion: value.sourceVersion, count: value.items.length });
    } else if (family === 'work') {
      const [projects, boards, cronjobs] = await Promise.all([
        source.projects(),
        source.boards(),
        source.cronjobs(),
      ]);
      output.push({
        family,
        sourceVersion: sourceVersion([
          projects.sourceVersion,
          boards.sourceVersion,
          cronjobs.sourceVersion,
        ]),
        count: projects.items.length + boards.items.length + cronjobs.items.length,
      });
    } else {
      const value = await source.sessions();
      output.push({ family, sourceVersion: value.sourceVersion, count: value.items.length });
    }
  }
  return output;
}

function commandAuditFields(value: unknown) {
  const body =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const actor =
    body.actor && typeof body.actor === 'object' && !Array.isArray(body.actor)
      ? (body.actor as Record<string, unknown>)
      : {};
  return {
    mode: typeof body.mode === 'string' ? body.mode : undefined,
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
    correlationId: typeof body.correlationId === 'string' ? body.correlationId : undefined,
    actorType: typeof actor.type === 'string' ? actor.type : undefined,
    actorId: typeof actor.id === 'string' ? actor.id : undefined,
  };
}

function mapError(error: unknown) {
  if (error instanceof AdapterError) return error;
  if (error instanceof SecondConsumerForbiddenError)
    return new AdapterError('SECOND_CONSUMER_FORBIDDEN', 403, error.message);
  if (error instanceof SourceConflictError) return new AdapterError('conflict', 409, error.message);
  if (error instanceof SourceUnavailableError)
    return new AdapterError('capability_unavailable', 503, error.message, true);
  if (error instanceof ModelConfirmationRequiredError)
    return new AdapterError('MODEL_CONFIRMATION_REQUIRED', 409, error.message);
  if (error instanceof IdempotencyConflictError)
    return new AdapterError('idempotency_conflict', 409, error.message);
  if (error instanceof IdempotencyBusyError)
    return new AdapterError('conflict', 409, error.message, true);
  const candidate = error as { validation?: unknown };
  if (candidate?.validation)
    return new AdapterError('invalid_request', 400, 'Request validation failed');
  return new AdapterError('internal_error', 500, 'Adapter request failed', true);
}
