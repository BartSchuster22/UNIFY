import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { GovernanceService } from '../governance/service.js';
import type { MemoryV4Adapter, MemoryV4Result } from '../memory-v4/client.js';
import { memoryRoute } from '../memory-v4/types.js';
import type { FrameworkRegistryService } from '../framework-registry/service.js';

const identifier = '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$';
const scope = '^(?:global|public|[^/\\s:]+:[^/\\s:]+(?:/[^/\\s:]+:[^/\\s:]+)*)$';
const commonQueryProperties = {
  scope_path: { type: 'string', pattern: scope, maxLength: 500 },
  include_public: { type: 'boolean' },
  limit: { type: 'integer', minimum: 1, maximum: 100 },
} as const;
const entityRef = {
  type: 'object',
  additionalProperties: false,
  required: ['entity_type', 'id'],
  properties: {
    entity_type: { type: 'string', pattern: identifier },
    id: { type: 'string', pattern: identifier },
  },
} as const;
const recordFields = {
  title: { type: 'string', minLength: 1, maxLength: 240 },
  content: { type: 'string', minLength: 1, maxLength: 200_000 },
  entity: entityRef,
  topic: { type: 'string', minLength: 1, maxLength: 240 },
  tags: {
    type: 'array',
    maxItems: 50,
    uniqueItems: true,
    items: { type: 'string', minLength: 1, maxLength: 100 },
  },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  source_refs: {
    type: 'array',
    maxItems: 100,
    items: { type: 'string', minLength: 1, maxLength: 2_048 },
  },
  provenance: { type: 'object', additionalProperties: true },
  attrs: { type: 'object', additionalProperties: true },
} as const;

type SearchBody = {
  q: string;
  scope_path?: string;
  include_public?: boolean;
  role?: 'canonical' | 'active' | 'evidence' | 'exhaust';
  lifecycle?: 'live' | 'working' | 'archived' | 'expired';
  entity_type?: string;
  entity_id?: string;
  tag?: string;
  limit?: number;
  cursor?: string;
};
type ContextBody = {
  entity_type: string;
  entity_id: string;
  scope_path?: string;
  include_public?: boolean;
  limit?: number;
};
type GetBody = { record_id: string; scope_path?: string };
type RememberBody = {
  title: string;
  content: string;
  scope_path?: string;
  entity?: { entity_type: string; id: string };
  topic?: string;
  tags?: string[];
  confidence?: number;
  source_refs?: string[];
  provenance?: Record<string, unknown>;
  attrs?: Record<string, unknown>;
};
type UpdateBody = {
  record_id: string;
  expected_version: number;
  reason?: string;
  patch: Omit<Partial<RememberBody>, 'scope_path'>;
};

type RouteOptions = {
  registry: FrameworkRegistryService;
  adapter: MemoryV4Adapter;
  governance?: GovernanceService | null;
};

export function registerFrameworkMemoryRoutes(app: FastifyInstance, options: RouteOptions): void {
  app.post<{ Body: SearchBody }>(
    '/api/v1/framework-tools/memory/search',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['q'],
          properties: {
            q: { type: 'string', minLength: 1, maxLength: 500 },
            ...commonQueryProperties,
            role: { enum: ['canonical', 'active', 'evidence', 'exhaust'] },
            lifecycle: { enum: ['live', 'working', 'archived', 'expired'] },
            entity_type: { type: 'string', pattern: identifier },
            entity_id: { type: 'string', pattern: identifier },
            tag: { type: 'string', minLength: 1, maxLength: 100 },
            cursor: { type: 'string', minLength: 1, maxLength: 2_048 },
          },
        },
      },
    },
    async (request, reply) =>
      execute(request, reply, options, 'memory:read', 'search', {
        method: 'GET',
        path: '/search',
        query: request.body,
      }),
  );

  app.post<{ Body: ContextBody }>(
    '/api/v1/framework-tools/memory/context',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['entity_type', 'entity_id'],
          properties: {
            entity_type: { type: 'string', pattern: identifier },
            entity_id: { type: 'string', pattern: identifier },
            ...commonQueryProperties,
          },
        },
      },
    },
    async (request, reply) => {
      const { entity_type, entity_id, ...query } = request.body;
      return execute(request, reply, options, 'memory:read', 'context', {
        method: 'GET',
        path: `/context/${encodeURIComponent(entity_type)}/${encodeURIComponent(entity_id)}`,
        query,
      });
    },
  );

  app.post<{ Body: GetBody }>(
    '/api/v1/framework-tools/memory/get',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['record_id'],
          properties: {
            record_id: { type: 'string', pattern: identifier },
            scope_path: commonQueryProperties.scope_path,
          },
        },
      },
    },
    async (request, reply) => {
      const { record_id, ...query } = request.body;
      return execute(request, reply, options, 'memory:read', 'get', {
        method: 'GET',
        path: `/records/${encodeURIComponent(record_id)}`,
        query,
      });
    },
  );

  app.post<{ Body: RememberBody }>(
    '/api/v1/framework-tools/memory/remember',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'content'],
          properties: { ...recordFields, scope_path: commonQueryProperties.scope_path },
        },
      },
    },
    async (request, reply) =>
      execute(request, reply, options, 'memory:write', 'remember', {
        method: 'POST',
        path: '/records',
        body: request.body,
      }),
  );

  app.post<{ Body: UpdateBody }>(
    '/api/v1/framework-tools/memory/update',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['record_id', 'expected_version', 'patch'],
          properties: {
            record_id: { type: 'string', pattern: identifier },
            expected_version: { type: 'integer', minimum: 1 },
            reason: { type: 'string', minLength: 1, maxLength: 500 },
            patch: {
              type: 'object',
              additionalProperties: false,
              minProperties: 1,
              properties: recordFields,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { record_id, expected_version, reason, patch } = request.body;
      return execute(request, reply, options, 'memory:write', 'update', {
        method: 'PATCH',
        path: `/records/${encodeURIComponent(record_id)}`,
        body: patch,
        ifMatch: String(expected_version),
        ...(reason ? { reason } : {}),
      });
    },
  );
}

type Relay = {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  ifMatch?: string;
  reason?: string;
};

async function execute(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RouteOptions,
  requiredScope: 'memory:read' | 'memory:write',
  operation: string,
  relay: Relay,
): Promise<unknown> {
  const identity = await options.registry.authenticateBearer(
    bearer(request.headers.authorization),
    requiredScope,
  );
  const route = memoryRoute(relay.method, relay.path);
  if (!route) throw new Error('Framework memory route is not governed');
  const idempotencyKey = header(request, 'idempotency-key');
  const body =
    operation === 'remember'
      ? governedRecordBody(relay.body as RememberBody, identity.frameworkId)
      : relay.body;
  try {
    const result = await options.adapter.execute({
      ...relay,
      body,
      route,
      actorUserId: `framework:${identity.frameworkId}`,
      requestId: request.id,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    await audit(options, request, identity.frameworkId, operation, 'success', result.statusCode);
    return send(reply, result);
  } catch (error) {
    await audit(options, request, identity.frameworkId, operation, 'failed');
    throw error;
  }
}

function governedRecordBody(body: RememberBody, frameworkId: string): Record<string, unknown> {
  return {
    ...body,
    role: 'active',
    lifecycle: 'working',
    write_policy: 'author_only',
    provenance: {
      ...(body.provenance ?? {}),
      source: 'unify-framework-tool',
      framework_id: frameworkId,
    },
  };
}

function bearer(value: string | undefined): string | undefined {
  const matched = /^Bearer ([^\s]+)$/.exec(value ?? '');
  return matched?.[1];
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function send(reply: FastifyReply, result: MemoryV4Result): unknown {
  reply.header('x-memoryv4-contract-version', result.contractVersion);
  if (result.idempotencyReplayed) reply.header('idempotency-replayed', result.idempotencyReplayed);
  return reply.status(result.statusCode).send(result.body);
}

async function audit(
  options: RouteOptions,
  request: FastifyRequest,
  frameworkId: string,
  operation: string,
  outcome: string,
  upstreamStatus?: number,
): Promise<void> {
  await options.governance?.audit({
    action: `framework.memory.${operation}`,
    outcome,
    requestId: request.id,
    target: { frameworkId, resource: 'memory' },
    details: {
      authentication: 'framework-service',
      requiredScope: `memory:${operation === 'remember' || operation === 'update' ? 'write' : 'read'}`,
      ...(upstreamStatus ? { upstreamStatus } : {}),
    },
  });
}
