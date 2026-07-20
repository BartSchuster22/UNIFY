import { GovernanceError } from '../governance/service.js';

export type MutationTarget = {
  owner: 'hermes' | 'dmm' | 'worker' | 'chat' | 'memory-v4';
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
type EndpointOwner = Exclude<Owner, 'hermes'> | 'agency';
type Session = { cookie: string; csrf?: string };
type OwnerConfig = {
  agencyUrl: string;
  agencyUsername: string;
  agencyPassword: string;
  dmmUrl: string;
  dmmUsername: string;
  dmmPassword: string;
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
  destructive?: boolean;
};

export const mutationDefinitions: Record<string, MutationDefinition> = {
  'profile.identity.update': { owner: 'hermes', kind: 'profile', permission: 'profiles.manage' },
  'profile.model.update': { owner: 'hermes', kind: 'profile', permission: 'models.manage' },
  'profile.runtime.start': { owner: 'hermes', kind: 'profile', permission: 'profiles.manage' },
  'profile.runtime.stop': { owner: 'hermes', kind: 'profile', permission: 'profiles.manage' },
  'profile.runtime.restart': { owner: 'hermes', kind: 'profile', permission: 'profiles.manage' },
  'profile.create': { owner: 'hermes', kind: 'profile', permission: 'profiles.manage' },
  'profile.delete': {
    owner: 'hermes',
    kind: 'profile',
    permission: 'profiles.delete',
    destructive: true,
  },
  'dmm.credential.save': { owner: 'dmm', kind: 'provider', permission: 'credentials.manage' },
  'dmm.credential.validate': { owner: 'dmm', kind: 'provider', permission: 'credentials.manage' },
  'dmm.credential.delete': {
    owner: 'dmm',
    kind: 'provider',
    permission: 'credentials.manage',
    destructive: true,
  },
  'worker.project.create': { owner: 'worker', kind: 'project', permission: 'work.manage' },
  'worker.project.update': { owner: 'worker', kind: 'project', permission: 'work.manage' },
  'worker.project.start': { owner: 'worker', kind: 'project', permission: 'work.manage' },
  'worker.project.stop': { owner: 'worker', kind: 'project', permission: 'work.manage' },
  'worker.project.delete': {
    owner: 'worker',
    kind: 'project',
    permission: 'work.manage',
    destructive: true,
  },
  'worker.task.create': { owner: 'worker', kind: 'task', permission: 'work.manage' },
  'worker.task.comment': { owner: 'worker', kind: 'task', permission: 'work.manage' },
  'worker.task.start': { owner: 'worker', kind: 'task', permission: 'work.manage' },
  'worker.task.move': { owner: 'worker', kind: 'task', permission: 'work.manage' },
  'worker.task.block': { owner: 'worker', kind: 'task', permission: 'work.manage' },
  'worker.task.unblock': { owner: 'worker', kind: 'task', permission: 'work.manage' },
  'worker.task.complete': { owner: 'worker', kind: 'task', permission: 'work.manage' },
  'worker.cron.create': { owner: 'worker', kind: 'cronjob', permission: 'work.manage' },
  'worker.cron.run': { owner: 'worker', kind: 'cronjob', permission: 'work.manage' },
  'worker.cron.pause': { owner: 'worker', kind: 'cronjob', permission: 'work.manage' },
  'worker.cron.resume': { owner: 'worker', kind: 'cronjob', permission: 'work.manage' },
  'worker.cron.delete': {
    owner: 'worker',
    kind: 'cronjob',
    permission: 'work.manage',
    destructive: true,
  },
  'chat.message.send': { owner: 'chat', kind: 'chat-session', permission: 'chat.use' },
  'chat.upload': { owner: 'chat', kind: 'chat-session', permission: 'chat.use' },
  'memory.record.write': { owner: 'memory-v4', kind: 'memory-record', permission: 'memory.write' },
};

export class MutationOwnerClient {
  readonly #config: OwnerConfig;
  readonly #sessions = new Map<'agency' | 'dmm' | 'chat', Session>();

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
      agencyUrl: required('AGENCY_URL'),
      agencyUsername: required('AGENCY_USERNAME'),
      agencyPassword: required('AGENCY_PASSWORD'),
      dmmUrl: required('DMM_URL'),
      dmmUsername: required('DMM_USERNAME'),
      dmmPassword: required('DMM_PASSWORD'),
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
    const { operationType: action, payload, target } = input;
    if (action === 'profile.create') {
      if (!/^[a-zA-Z0-9_-]+$/.test(target.nativeId))
        throw new GovernanceError('MUTATION_TARGET_INVALID', 422, 'Profile ID is invalid');
      string(payload.displayName, 'displayName');
      nonEmptyArray(payload.identityFiles, 'identityFiles');
      string(record(payload.modelConfig, 'modelConfig').primary, 'modelConfig.primary');
    }
    if (action === 'profile.identity.update') nonEmptyArray(payload.identityFiles, 'identityFiles');
    if (action === 'profile.model.update')
      string(record(payload.modelConfig, 'modelConfig').primary, 'modelConfig.primary');
    if (action === 'dmm.credential.save') string(payload.secret, 'secret');
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
    const framework = encodeURIComponent(target.frameworkId ?? '');

    if (action === 'profile.create')
      return this.json('agency', 'POST', `/api/frameworks/${framework}/profiles`, {
        ...payload,
        profileId: target.nativeId,
        dryRun,
      });
    if (action === 'profile.identity.update')
      return this.json('agency', 'PUT', `/api/frameworks/${framework}/profiles/${id}/identity`, {
        ...payload,
        dryRun,
      });
    if (action === 'profile.model.update')
      return this.json(
        'agency',
        'PUT',
        `/api/frameworks/${framework}/profiles/${id}/model-config`,
        { ...payload, dryRun },
      );
    if (action.startsWith('profile.runtime.')) {
      const runtimeAction = action.slice('profile.runtime.'.length);
      return this.json(
        'agency',
        'POST',
        `/api/frameworks/${framework}/profiles/${id}/runtime/${runtimeAction}`,
        { ...payload, dryRun },
      );
    }
    if (action === 'profile.delete')
      return this.json('agency', 'DELETE', `/api/frameworks/${framework}/profiles/${id}`, {
        dryRun,
      });

    if (action === 'dmm.credential.save')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('dmm', 'POST', `/api/providers/${id}/credential`, payload);
    if (action === 'dmm.credential.validate')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('dmm', 'POST', `/api/providers/${id}/validate`, {});
    if (action === 'dmm.credential.delete')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('dmm', 'DELETE', `/api/providers/${id}/credential`, {});

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

    if (action === 'chat.message.send')
      return dryRun
        ? { valid: true, dryRun: true }
        : this.json('chat', 'POST', `/api/chat/sessions/${id}/messages`, payload);
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
    if (
      response.status === 401 &&
      !retried &&
      (owner === 'agency' || owner === 'dmm' || owner === 'chat')
    ) {
      this.#sessions.delete(owner);
      await response.arrayBuffer();
      return this.json(owner, method, path, body, true);
    }
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024)
      throw new GovernanceError('UPSTREAM_RESPONSE_TOO_LARGE', 502, 'Owner response exceeds 2 MB');
    if (!response.ok) throw upstreamError(owner, response.status, text);
    try {
      return text ? JSON.parse(text) : { ok: true };
    } catch {
      throw new GovernanceError('UPSTREAM_INVALID_RESPONSE', 502, 'Owner returned invalid JSON');
    }
  }

  private async session(owner: 'agency' | 'dmm' | 'chat'): Promise<Session> {
    const current = this.#sessions.get(owner);
    if (current) return current;
    const endpoint = owner === 'chat' ? '/auth/login' : '/api/auth/login';
    const payload =
      owner === 'chat'
        ? { password: this.#config.chatPassword }
        : owner === 'agency'
          ? { username: this.#config.agencyUsername, password: this.#config.agencyPassword }
          : { username: this.#config.dmmUsername, password: this.#config.dmmPassword };
    const response = await fetch(`${this.url(owner)}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw upstreamError(owner, response.status);
    const rawCookie = response.headers.get('set-cookie');
    if (!rawCookie)
      throw new GovernanceError('UPSTREAM_AUTH_FAILED', 502, `${owner} did not issue a session`);
    const cookie = rawCookie.split(';', 1)[0]!;
    let csrf: string | undefined;
    if (owner === 'dmm') {
      const data = (await response.json()) as { data?: { csrfToken?: string } };
      csrf = data.data?.csrfToken;
      if (!csrf)
        throw new GovernanceError('UPSTREAM_AUTH_FAILED', 502, 'DMM did not issue a CSRF token');
    } else await response.arrayBuffer();
    const session = { cookie, ...(csrf ? { csrf } : {}) };
    this.#sessions.set(owner, session);
    return session;
  }

  private url(owner: EndpointOwner): string {
    return base(
      owner === 'agency'
        ? this.#config.agencyUrl
        : owner === 'dmm'
          ? this.#config.dmmUrl
          : owner === 'worker'
            ? this.#config.workerUrl
            : owner === 'chat'
              ? this.#config.chatUrl
              : this.#config.memoryUrl,
    );
  }
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
