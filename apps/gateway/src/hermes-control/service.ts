import { createHash } from 'node:crypto';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  type FrameworkScope,
  type HermesControlCommand,
} from '@aquiero/contracts';
import type { FrameworkRegistryService } from '../framework-registry/service.js';
import type { FrameworkConnection } from '../framework-registry/types.js';
import { GovernanceError } from '../governance/service.js';
import { HermesControlClient, HermesControlClientError, type PageQuery } from './client.js';
import {
  gatewayEventCursor,
  parseGatewayEventCursor,
  type FrameworkEventJournal,
} from './event-journal.js';

export type HermesControlClientFactory = (connection: FrameworkConnection) => HermesControlClient;

export interface GatewayCommandContext {
  actorUserId: string;
  operationId: string;
  idempotencyKey: string;
}

export class HermesGatewayService {
  private readonly clients = new Map<
    string,
    { baseUrl: string; bearerToken: string; client: HermesControlClient }
  >();

  constructor(
    private readonly registry: FrameworkRegistryService,
    private readonly journal: FrameworkEventJournal,
    private readonly clientFactory: HermesControlClientFactory = (connection) =>
      new HermesControlClient({
        baseUrl: connection.baseUrl,
        bearerToken: connection.bearerToken,
      }),
  ) {}

  async ready() {
    return (await this.registry.ready()) && (await this.journal.ready());
  }

  async capabilities(frameworkId: string) {
    const response = await this.read(frameworkId, (client) => client.capabilities());
    return projectEnvelope(response);
  }

  async health(frameworkId: string) {
    const response = await this.read(frameworkId, (client) => client.health());
    return projectEnvelope(response);
  }

  async profiles(frameworkId: string, query: PageQuery) {
    return projectCollection(await this.read(frameworkId, (client) => client.profiles(query)));
  }

  async providers(frameworkId: string, query: PageQuery) {
    return projectCollection(await this.read(frameworkId, (client) => client.providers(query)));
  }

  async boards(frameworkId: string, query: PageQuery) {
    return projectCollection(await this.read(frameworkId, (client) => client.boards(query)));
  }

  async tasks(frameworkId: string, boardId: string, query: PageQuery) {
    return projectCollection(
      await this.read(frameworkId, (client) => client.tasks(boardId, query)),
    );
  }

  async sessions(frameworkId: string, query: PageQuery) {
    return projectCollection(await this.read(frameworkId, (client) => client.sessions(query)));
  }

  async messages(frameworkId: string, sessionId: string, query: PageQuery) {
    return projectCollection(
      await this.read(frameworkId, (client) => client.messages(sessionId, query)),
    );
  }

  async reconcile(
    frameworkId: string,
    input: {
      mode: 'validate' | 'dry-run' | 'execute';
      families?: unknown;
      expectedSourceVersion?: unknown;
    },
    context: GatewayCommandContext,
  ) {
    const expectedSourceVersion = optionalString(
      input.expectedSourceVersion,
      'expectedSourceVersion',
    );
    const command: HermesControlCommand = {
      mode: input.mode,
      idempotencyKey: gatewayIdempotencyKey(context.actorUserId, context.idempotencyKey),
      ...(expectedSourceVersion ? { expectedSourceVersion } : {}),
      requestId: context.operationId,
      correlationId: context.operationId,
      actor: { type: 'user', id: context.actorUserId },
      payload: input.families === undefined ? {} : { families: input.families },
    };
    return this.call(frameworkId, 'control:execute', async (client) => {
      const result = await client.reconcile(command);
      assertProvenance(frameworkId, result);
      const expectedStatus =
        input.mode === 'validate'
          ? 'validated'
          : input.mode === 'dry-run'
            ? 'dry-run'
            : 'completed';
      if (result.data.status !== expectedStatus)
        throw new GovernanceError(
          'FRAMEWORK_VERIFICATION_FAILED',
          502,
          'Hermes command did not return the expected terminal status',
        );
      return projectEnvelope(result);
    });
  }

  async ingest(frameworkId: string) {
    return this.call(frameworkId, 'control:events', async (client) => {
      let cursor = (await this.journal.cursor(frameworkId)).sourceCursor;
      let inserted = 0;
      for (let page = 0; page < 100; page += 1) {
        const response = await client.events({ ...(cursor ? { cursor } : {}), limit: 500 });
        assertProvenance(frameworkId, response);
        inserted += await this.journal.ingest(
          frameworkId,
          response.data.items,
          response.data.page.nextCursor,
          response.data.page.hasMore ? 'replaying' : 'current',
        );
        if (!response.data.page.hasMore) return { inserted, state: 'current' as const };
        const next = response.data.page.nextCursor;
        if (!next || next === cursor)
          throw new GovernanceError(
            'FRAMEWORK_EVENT_REPLAY_STALLED',
            502,
            'Hermes event replay did not advance its cursor',
          );
        cursor = next;
      }
      throw new GovernanceError(
        'FRAMEWORK_EVENT_REPLAY_LIMIT',
        503,
        'Hermes event replay exceeded the bounded page limit',
      );
    });
  }

  async events(frameworkId: string, query: PageQuery) {
    const limit = validLimit(query.limit);
    let freshness: 'current' | 'stale' | 'unavailable' = 'current';
    let warning: string | undefined;
    try {
      await this.ingest(frameworkId);
    } catch (error) {
      await this.journal.markUnavailable(frameworkId);
      const prior = await this.journal.list(frameworkId, 0, 1);
      freshness = prior.length ? 'stale' : 'unavailable';
      warning = safeErrorCode(error);
    }
    const after = parseCursor(query.cursor);
    const events = await this.journal.list(frameworkId, after, limit + 1);
    const hasMore = events.length > limit;
    const items = events.slice(0, limit);
    const last = items.at(-1)?.sequence;
    return {
      meta: {
        owner: 'hermes' as const,
        frameworkId,
        frameworkVersion: PINNED_HERMES_RELEASE,
        frameworkCommit: PINNED_HERMES_COMMIT,
        freshness,
        generatedAt: new Date().toISOString(),
        ...(warning ? { warnings: [{ code: warning }] } : { warnings: [] }),
      },
      items,
      page: {
        hasMore,
        ...(hasMore && last !== undefined ? { nextCursor: gatewayEventCursor(last) } : {}),
      },
    };
  }

  async ingestAll() {
    const registrations = await this.registry.list();
    const enabled = registrations.filter(
      (item) =>
        item.enabled && item.status === 'verified' && item.scopes.includes('control:events'),
    );
    return Promise.allSettled(enabled.map((item) => this.ingest(item.frameworkId)));
  }

  private read<
    T extends {
      contractVersion: string;
      frameworkId: string;
      frameworkVersion: string;
      frameworkCommit: string;
    },
  >(frameworkId: string, action: (client: HermesControlClient) => Promise<T>) {
    return this.call(frameworkId, 'control:read', async (client) => {
      const result = await action(client);
      assertProvenance(frameworkId, result);
      return result;
    });
  }

  private async call<T>(
    frameworkId: string,
    scope: FrameworkScope,
    action: (client: HermesControlClient) => Promise<T>,
  ): Promise<T> {
    const connection = await this.registry.connection(frameworkId, scope);
    const current = this.clients.get(frameworkId);
    const client =
      current?.baseUrl === connection.baseUrl && current.bearerToken === connection.bearerToken
        ? current.client
        : this.clientFactory(connection);
    if (client !== current?.client)
      this.clients.set(frameworkId, {
        baseUrl: connection.baseUrl,
        bearerToken: connection.bearerToken,
        client,
      });
    try {
      return await action(client);
    } catch (error) {
      if (error instanceof GovernanceError) throw error;
      if (error instanceof HermesControlClientError)
        throw new GovernanceError(error.code, error.statusCode, error.message);
      throw new GovernanceError('FRAMEWORK_UNAVAILABLE', 503, 'Hermes framework request failed');
    }
  }
}

function assertProvenance(
  frameworkId: string,
  response: {
    contractVersion: string;
    frameworkId: string;
    frameworkVersion: string;
    frameworkCommit: string;
  },
) {
  if (
    response.contractVersion !== HERMES_CONTROL_VERSION ||
    response.frameworkId !== frameworkId ||
    response.frameworkVersion !== PINNED_HERMES_RELEASE ||
    response.frameworkCommit !== PINNED_HERMES_COMMIT
  )
    throw new GovernanceError(
      'FRAMEWORK_PROVENANCE_MISMATCH',
      502,
      'Hermes response provenance does not match the registered framework',
    );
}

function projectEnvelope<T extends { data: unknown }>(
  response: T & {
    frameworkId: string;
    frameworkVersion: string;
    frameworkCommit: string;
    sourceVersion: string;
    observedAt: string;
  },
) {
  return {
    meta: provenance(response),
    data: response.data,
  };
}

function projectCollection<
  T extends {
    id: string;
  },
>(response: {
  frameworkId: string;
  frameworkVersion: string;
  frameworkCommit: string;
  sourceVersion: string;
  observedAt: string;
  data: { items: T[]; page: { nextCursor?: string; hasMore: boolean } };
}) {
  const meta = provenance(response);
  return {
    meta,
    items: response.data.items.map((item) => ({
      ...item,
      owner: 'hermes' as const,
      frameworkId: response.frameworkId,
      sourceVersion: response.sourceVersion,
      observedAt: response.observedAt,
    })),
    page: response.data.page,
  };
}

function provenance(response: {
  frameworkId: string;
  frameworkVersion: string;
  frameworkCommit: string;
  sourceVersion: string;
  observedAt: string;
}) {
  return {
    owner: 'hermes' as const,
    frameworkId: response.frameworkId,
    frameworkVersion: response.frameworkVersion,
    frameworkCommit: response.frameworkCommit,
    sourceVersion: response.sourceVersion,
    observedAt: response.observedAt,
    freshness: 'current' as const,
  };
}

function gatewayIdempotencyKey(actorUserId: string, idempotencyKey: string) {
  return `gw-${createHash('sha256').update(`${actorUserId}:${idempotencyKey}`).digest('hex')}`;
}

function optionalString(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, `${field} is invalid`);
  return value.trim();
}

function validLimit(value: number | undefined) {
  if (value === undefined) return 100;
  if (!Number.isInteger(value) || value < 1 || value > 500)
    throw new GovernanceError('INVALID_PAGE_LIMIT', 400, 'Page limit must be 1 to 500');
  return value;
}

function parseCursor(value: string | undefined) {
  try {
    return parseGatewayEventCursor(value);
  } catch {
    throw new GovernanceError('INVALID_CURSOR', 400, 'Gateway event cursor is invalid');
  }
}

function safeErrorCode(error: unknown) {
  if (error instanceof GovernanceError && /^[A-Z0-9_]{1,100}$/.test(error.code)) return error.code;
  return 'FRAMEWORK_UNAVAILABLE';
}
