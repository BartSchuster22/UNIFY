import WebSocket from 'ws';
import { GovernanceError } from '../../governance/service.js';

export type MutationTarget = {
  owner: 'hermes' | 'worker' | 'chat' | 'memory-v4';
  kind: string;
  nativeId: string;
  frameworkId?: string;
};

export type MutationInput = {
  operationType: string;
  target: MutationTarget;
  payload: Record<string, unknown>;
  mode: 'validate' | 'dry-run' | 'execute';
  confirmed: boolean;
};

type Owner = MutationTarget['owner'];
type EndpointOwner = Exclude<Owner, 'hermes'>;
type Session = { cookie: string; csrf?: string };
type OwnerConfig = {
  workerUrl: string;
  workerToken: string;
  chatUrl: string;
  chatPassword: string;
  memoryUrl: string;
  memoryToken: string;
};

export type MutationDefinition = {
  owner: Owner;
  kind: string;
  permission: string;
  /** Quarantined legacy migration execution path; never production-authoritative. */
  executionPath: 'migration-legacy';
  destructive?: boolean;
};

export const mutationDefinitions: Record<string, MutationDefinition> = {
  'worker.project.create': {
    owner: 'worker',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.project.update': {
    owner: 'worker',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.project.start': {
    owner: 'worker',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.project.stop': {
    owner: 'worker',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.project.delete': {
    owner: 'worker',
    kind: 'project',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
    destructive: true,
  },
  'worker.task.create': {
    owner: 'worker',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.task.comment': {
    owner: 'worker',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.task.start': {
    owner: 'worker',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.task.move': {
    owner: 'worker',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.task.block': {
    owner: 'worker',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.task.unblock': {
    owner: 'worker',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.task.complete': {
    owner: 'worker',
    kind: 'task',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.cron.create': {
    owner: 'worker',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.cron.run': {
    owner: 'worker',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.cron.pause': {
    owner: 'worker',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.cron.resume': {
    owner: 'worker',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
  },
  'worker.cron.delete': {
    owner: 'worker',
    kind: 'cronjob',
    permission: 'work.manage',
    executionPath: 'migration-legacy',
    destructive: true,
  },
  'chat.message.send': {
    owner: 'chat',
    kind: 'chat-session',
    permission: 'chat.use',
    executionPath: 'migration-legacy',
  },
  'chat.session.create': {
    owner: 'chat',
    kind: 'chat-session',
    permission: 'chat.use',
    executionPath: 'migration-legacy',
  },
  'chat.upload': {
    owner: 'chat',
    kind: 'chat-session',
    permission: 'chat.use',
    executionPath: 'migration-legacy',
  },
  'memory.record.write': {
    owner: 'memory-v4',
    kind: 'memory-record',
    permission: 'memory.write',
    executionPath: 'migration-legacy',
  },
};

export class MutationOwnerClient {
  readonly #config: OwnerConfig;
  readonly #sessions = new Map<'chat', Session>();
  readonly #unifyChatSessionIds = new Set<string>();

  constructor(config: OwnerConfig) {
    this.#config = config;
  }

  static fromEnv(env: NodeJS.ProcessEnv): MutationOwnerClient {
    const required = (name: string) => {
      const value = env[name]?.trim();
      if (!value) throw new Error(`${name} is required for mutation execution`);
      return value;
    };
    return new MutationOwnerClient({
      workerUrl: required('WORKER_URL'),
      workerToken: required('WORKER_TOKEN'),
      chatUrl: required('CHAT_URL'),
      chatPassword: required('CHAT_PASSWORD'),
      memoryUrl: required('MEMORY_V4_URL'),
      memoryToken: required('MEMORY_V4_TOKEN'),
    });
  }

  definition(operationType: string): MutationDefinition {
    const definition = mutationDefinitions[operationType];
    if (!definition)
      throw new GovernanceError('MUTATION_UNSUPPORTED', 422, 'Mutation type is not supported');
    return definition;
  }

  async chatWorkspace(sessionId?: string): Promise<{
    agents: unknown;
    sessions: unknown;
    messages?: unknown;
  }> {
    const [rawAgents, rawSessions] = await Promise.all([
      this.json('chat', 'GET', '/api/agents', undefined),
      this.json('chat', 'GET', '/api/chat/sessions', undefined),
    ]);
    const agents = sanitizeUnifyChatAgents(rawAgents);
    const { value: sessions, ids } = filterUnifyChatSessions(rawSessions);
    this.#unifyChatSessionIds.clear();
    for (const id of ids) this.#unifyChatSessionIds.add(id);
    const validatedSessionId = sessionId ? validSegment(sessionId, 'sessionId') : undefined;
    if (validatedSessionId && !ids.has(validatedSessionId))
      throw new GovernanceError(
        'CHAT_SESSION_NOT_FOUND',
        404,
        'CHAT session is unavailable in UNIFY',
      );
    const rawMessages = validatedSessionId
      ? await this.json(
          'chat',
          'GET',
          `/api/chat/sessions/${encodeURIComponent(validatedSessionId)}/messages`,
          undefined,
          false,
          16 * 1024 * 1024,
        )
      : undefined;
    const messages = rawMessages === undefined ? undefined : latestChatMessages(rawMessages, 500);
    return { agents, sessions, ...(messages === undefined ? {} : { messages }) };
  }

  async openChatRealtime(
    onFrame: (frame: unknown) => void,
    onDisconnect: (reason: string) => void,
    lastEventId?: string,
  ): Promise<() => void> {
    const ownerSession = await this.session('chat');
    const endpoint = new URL('/api/realtime', this.url('chat'));
    endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
    let intentionallyClosed = false;
    let disconnectReported = false;
    const reportDisconnect = (reason: string) => {
      if (!intentionallyClosed && !disconnectReported) {
        disconnectReported = true;
        onDisconnect(reason);
      }
    };
    const socket = new WebSocket(endpoint, { headers: { cookie: ownerSession.cookie } });
    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          topics: ['chat:*'],
          ...(lastEventId ? { last_event_id: lastEventId } : {}),
        }),
      );
    });
    socket.on('message', (data) => {
      try {
        const frame: unknown = JSON.parse(data.toString());
        if (this.isUnifyChatFrame(frame)) onFrame(frame);
      } catch {
        // Ignore malformed owner frames; the stream remains usable.
      }
    });
    socket.on('error', () => reportDisconnect('upstream_error'));
    socket.on('close', () => reportDisconnect('upstream_closed'));
    return () => {
      intentionallyClosed = true;
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
        socket.close();
    };
  }

  private isUnifyChatFrame(frame: unknown): boolean {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return false;
    const value = frame as Record<string, unknown>;
    const payload = recordOrUndefined(value.payload);
    const session = recordOrUndefined(payload?.session);
    const source = stringOrUndefined(value.source) ?? stringOrUndefined(session?.source);
    const sessionId =
      stringOrUndefined(value.session_id) ??
      stringOrUndefined(payload?.session_id) ??
      stringOrUndefined(session?.id);
    if (source && source !== 'dashboard_native') return false;
    if (source === 'dashboard_native' && sessionId) this.#unifyChatSessionIds.add(sessionId);
    if (sessionId) return this.#unifyChatSessionIds.has(sessionId);
    return value.type === 'realtime.connected' || value.type === 'realtime.subscribed';
  }

  validate(input: MutationInput): MutationDefinition {
    const definition = this.definition(input.operationType);
    if (input.target.owner !== definition.owner || input.target.kind !== definition.kind)
      throw new GovernanceError(
        'MUTATION_TARGET_INVALID',
        422,
        'Mutation target does not match operation type',
      );
    if (!input.target.nativeId.trim() || input.target.nativeId.length > 1024)
      throw new GovernanceError('MUTATION_TARGET_INVALID', 422, 'Mutation target id is invalid');
    if (definition.destructive && input.mode === 'execute' && !input.confirmed)
      throw new GovernanceError('CONFIRMATION_REQUIRED', 409, 'Explicit confirmation is required');
    if (input.target.owner === 'hermes' && !input.target.frameworkId?.trim())
      throw new GovernanceError(
        'FRAMEWORK_REQUIRED',
        422,
        'Hermes profile mutations require frameworkId',
      );
    if (input.operationType === 'memory.record.write') {
      const role = input.payload.role;
      const lifecycle = input.payload.lifecycle;
      const permitted =
        (role === 'active' && lifecycle === 'working') ||
        (role === 'evidence' && (lifecycle === 'working' || lifecycle === 'live'));
      if (!permitted)
        throw new GovernanceError(
          'MEMORY_WRITE_DENIED',
          403,
          'Only active/working and evidence/working-or-live MemoryV4 records are permitted',
        );
    }
    this.validatePayload(input);
    return definition;
  }

  private validatePayload(input: MutationInput): void {
    const { operationType: action, payload } = input;

    if (action === 'worker.project.create') string(payload.name, 'name');
    if (action === 'worker.task.create') {
      string(payload.harness, 'harness');
      string(payload.title, 'title');
    }
    if (action === 'worker.cron.create') {
      string(payload.harness, 'harness');
      string(payload.title, 'title');
      record(payload.schedule, 'schedule');
    }
    if (action === 'chat.message.send') nonEmptyArray(payload.blocks, 'blocks');
    if (action === 'chat.session.create') {
      string(payload.agent_id, 'agent_id');
      string(payload.title, 'title');
      if (payload.source !== undefined && payload.source !== 'dashboard_native')
        throw new GovernanceError(
          'EXTERNAL_CHAT_EXCLUDED',
          422,
          'External-channel sessions are excluded from UNIFY',
        );
      for (const field of ['external_identity', 'channel_label', 'surface', 'route'])
        if (payload[field] !== undefined)
          throw new GovernanceError(
            'EXTERNAL_CHAT_EXCLUDED',
            422,
            'External-channel session metadata is excluded from UNIFY',
          );
    }
    if (action === 'chat.upload') {
      const name = string(payload.name, 'name');
      const mime = string(payload.mime, 'mime').toLowerCase();
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(name) || name.includes('..'))
        throw new GovernanceError('CHAT_UPLOAD_NAME_INVALID', 422, 'Upload filename is invalid');
      const allowedMime = new Set([
        'application/octet-stream',
        'application/pdf',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/webp',
        'text/plain',
      ]);
      if (!allowedMime.has(mime))
        throw new GovernanceError(
          'CHAT_UPLOAD_TYPE_DENIED',
          415,
          'Upload media type is not allowed',
        );
      const data = string(payload.data, 'data');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0)
        throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, 'data must be valid base64');
      if (Buffer.byteLength(data, 'base64') > 10 * 1024 * 1024)
        throw new GovernanceError('CHAT_UPLOAD_TOO_LARGE', 413, 'Chat upload exceeds 10 MB');
    }
    if (action === 'memory.record.write') {
      string(payload.entityType, 'entityType');
      string(payload.entityId, 'entityId');
      string(payload.topic, 'topic');
      string(payload.title, 'title');
      string(payload.content, 'content');
    }
  }

  async execute(input: MutationInput): Promise<unknown> {
    this.validate(input);
    if (input.mode === 'validate') return { valid: true, operationType: input.operationType };
    const dryRun = input.mode === 'dry-run';
    const { operationType: action, target, payload } = input;
    const id = encodeURIComponent(target.nativeId);

    if (action === 'worker.project.create')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('worker', 'POST', '/api/kanban/projects', payload);
    if (action === 'worker.project.update')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('worker', 'PATCH', `/api/kanban/projects/${id}`, payload);
    if (action === 'worker.project.delete')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('worker', 'DELETE', `/api/kanban/projects/${id}`, {
            ...payload,
            confirm: true,
          });
    if (action === 'worker.project.start' || action === 'worker.project.stop')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json(
            'worker',
            'POST',
            `/api/kanban/projects/${id}/${action.endsWith('start') ? 'start' : 'stop'}`,
            payload,
          );
    if (action === 'worker.task.create')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('worker', 'POST', '/api/kanban/tasks', payload);
    if (action.startsWith('worker.task.')) {
      const taskAction = action.slice('worker.task.'.length);
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json(
            'worker',
            'POST',
            `/api/kanban/tasks/${id}/${taskAction === 'comment' ? 'comments' : taskAction}`,
            payload,
          );
    }
    if (action === 'worker.cron.create')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('worker', 'POST', '/api/cron/jobs', payload);
    if (action.startsWith('worker.cron.')) {
      const cronAction = action.slice('worker.cron.'.length);
      if (dryRun) return { valid: true, dryRun: true };
      if (cronAction === 'delete')
        return this.json('worker', 'DELETE', `/api/cron/jobs/${id}`, { ...payload, confirm: true });
      return this.json('worker', 'POST', `/api/cron/jobs/${id}/${cronAction}`, payload);
    }

    if (action === 'chat.message.send') {
      await this.assertUnifyChatSession(target.nativeId);
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('chat', 'POST', `/api/chat/sessions/${id}/messages`, payload);
    }
    if (action === 'chat.session.create')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('chat', 'POST', '/api/chat/sessions', payload);
    if (action === 'chat.upload')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('chat', 'POST', '/api/uploads', payload);

    if (action === 'memory.record.write') {
      const entityType = string(payload.entityType, 'entityType');
      const entityId = string(payload.entityId, 'entityId');
      const record = { ...payload };
      delete record.entityType;
      delete record.entityId;
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json(
            'memory-v4',
            'POST',
            `/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/records`,
            record,
          );
    }

    throw new GovernanceError('MUTATION_UNSUPPORTED', 422, 'Mutation type is not supported');
  }

  private async assertUnifyChatSession(sessionId: string): Promise<void> {
    await this.chatWorkspace(sessionId);
  }

  async download(path: string): Promise<{ body: Buffer; contentType: string; filename: string }> {
    if (!/^\/uploads\/[a-zA-Z0-9._-]+$/.test(path))
      throw new GovernanceError('CHAT_DOWNLOAD_PATH_INVALID', 422, 'Chat download path is invalid');
    const session = await this.session('chat');
    const response = await fetch(`${base(this.#config.chatUrl)}${path}`, {
      headers: { cookie: session.cookie },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw upstreamError('chat', response.status);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 10 * 1024 * 1024)
      throw new GovernanceError('CHAT_DOWNLOAD_TOO_LARGE', 413, 'Chat download exceeds 10 MB');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 10 * 1024 * 1024)
      throw new GovernanceError('CHAT_DOWNLOAD_TOO_LARGE', 413, 'Chat download exceeds 10 MB');
    return {
      body,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      filename: path.split('/').at(-1)!,
    };
  }

  private async json(
    owner: EndpointOwner,
    method: string,
    path: string,
    body: unknown,
    retried = false,
    maxResponseChars = 2 * 1024 * 1024,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (owner === 'worker') headers.authorization = `Bearer ${this.#config.workerToken}`;
    else if (owner === 'memory-v4') headers.authorization = `Bearer ${this.#config.memoryToken}`;
    else {
      const session = await this.session(owner);
      headers.cookie = session.cookie;
      if (session.csrf) headers['x-csrf-token'] = session.csrf;
    }
    const requestInit: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(20_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
    const response = await fetch(`${this.url(owner)}${path}`, requestInit);
    if (response.status === 401 && !retried && owner === 'chat') {
      this.#sessions.delete(owner);
      await response.arrayBuffer();
      return this.json(owner, method, path, body, true, maxResponseChars);
    }
    const text = await response.text();
    if (text.length > maxResponseChars)
      throw new GovernanceError(
        'UPSTREAM_RESPONSE_TOO_LARGE',
        502,
        `Owner response exceeds ${Math.round(maxResponseChars / 1024 / 1024)} MB`,
      );
    if (!response.ok) throw upstreamError(owner, response.status, text);
    try {
      return text ? JSON.parse(text) : { ok: true };
    } catch {
      throw new GovernanceError('UPSTREAM_INVALID_RESPONSE', 502, 'Owner returned invalid JSON');
    }
  }

  private async session(owner: 'chat'): Promise<Session> {
    const current = this.#sessions.get(owner);
    if (current) return current;
    const response = await fetch(`${this.url(owner)}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ password: this.#config.chatPassword }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw upstreamError(owner, response.status);
    const rawCookie = response.headers.get('set-cookie');
    if (!rawCookie)
      throw new GovernanceError('UPSTREAM_AUTH_FAILED', 502, `${owner} did not issue a session`);
    const cookie = rawCookie.split(';', 1)[0]!;
    await response.arrayBuffer();
    const session = { cookie };
    this.#sessions.set(owner, session);
    return session;
  }

  private url(owner: EndpointOwner): string {
    return base(
      owner === 'worker'
        ? this.#config.workerUrl
        : owner === 'chat'
          ? this.#config.chatUrl
          : this.#config.memoryUrl,
    );
  }
}

function filterUnifyChatSessions(value: unknown): { value: unknown; ids: Set<string> } {
  const ids = new Set<string>();
  const filter = (items: unknown[]): unknown[] =>
    items.filter((item) => {
      const session = recordOrUndefined(item);
      const internal = session?.source === 'dashboard_native';
      if (internal) {
        const id = stringOrUndefined(session.id);
        if (id) ids.add(id);
      }
      return internal;
    });
  if (Array.isArray(value)) return { value: filter(value), ids };
  const response = recordOrUndefined(value);
  if (!response) return { value, ids };
  for (const key of ['sessions', 'items', 'data']) {
    if (Array.isArray(response[key]))
      return { value: { ...response, [key]: filter(response[key]) }, ids };
  }
  return { value, ids };
}

function sanitizeUnifyChatAgents(value: unknown): unknown {
  const sanitize = (items: unknown[]): unknown[] =>
    items.map((item) => {
      const agent = recordOrUndefined(item);
      if (!agent) return item;
      const capabilities = recordOrUndefined(agent.capabilities);
      const safeAgent = { ...agent };
      delete safeAgent.channel_bindings;
      const safeCapabilities = capabilities ? { ...capabilities } : undefined;
      if (safeCapabilities) delete safeCapabilities.external_channels;
      return {
        ...safeAgent,
        ...(safeCapabilities ? { capabilities: safeCapabilities } : {}),
      };
    });
  if (Array.isArray(value)) return sanitize(value);
  const response = recordOrUndefined(value);
  if (!response) return value;
  for (const key of ['agents', 'items', 'data']) {
    if (Array.isArray(response[key])) return { ...response, [key]: sanitize(response[key]) };
  }
  return value;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function latestChatMessages(value: unknown, limit: number): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const response = value as Record<string, unknown>;
  const messages = response.messages;
  if (!Array.isArray(messages)) return value;
  return {
    ...response,
    messages: messages.slice(-limit),
    total: messages.length,
    truncated: messages.length > limit,
  };
}

function validSegment(value: string, field: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(normalized))
    throw new GovernanceError('MUTATION_TARGET_INVALID', 422, `${field} is invalid`);
  return normalized;
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, `${field} is required`);
  return value.trim();
}
function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new GovernanceError('MUTATION_PAYLOAD_INVALID', 422, `${field} must be an object`);
  return value as Record<string, unknown>;
}
function nonEmptyArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new GovernanceError(
      'MUTATION_PAYLOAD_INVALID',
      422,
      `${field} must be a non-empty array`,
    );
  return value;
}
function base(value: string): string {
  return value.replace(/\/+$/, '');
}
function upstreamError(owner: string, status: number, responseBody = ''): GovernanceError {
  let detail = '';
  try {
    const parsed = JSON.parse(responseBody) as { error?: unknown; code?: unknown };
    const candidate = typeof parsed.error === 'string' ? parsed.error : parsed.code;
    if (typeof candidate === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(candidate))
      detail = candidate;
  } catch {
    // Owner error bodies are optional and never copied verbatim.
  }
  const suffix = detail ? ` (${detail})` : '';
  const code = detail
    ? `UPSTREAM_${detail.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`
    : 'UPSTREAM_MUTATION_FAILED';
  return new GovernanceError(
    code,
    status >= 400 && status < 500 ? status : 502,
    `${owner} rejected the mutation${suffix}`,
  );
}
