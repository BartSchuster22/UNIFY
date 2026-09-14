import type {
  ApiFailure,
  FederationLeaseCollection,
  FederationLeaseRequest,
  FederationLeaseResponse,
  MutationRequest,
  MutationResponse,
  Principal,
} from './types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly failure: ApiFailure,
  ) {
    super(failure.message);
  }
}

function csrfToken(): string | undefined {
  return document.cookie
    .split('; ')
    .find((part) => part.startsWith('aquiero_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf && init.method && init.method !== 'GET')
    headers.set('x-csrf-token', decodeURIComponent(csrf));
  const response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: 'include' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: ApiFailure };
    throw new ApiError(
      response.status,
      body.error ?? { code: 'REQUEST_FAILED', message: `Request failed (${response.status})` },
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export function memoryMutation<T>(
  path: string,
  method: 'POST' | 'PATCH',
  options: { body?: unknown; version?: number; reason?: string } = {},
): Promise<T> {
  const headers = new Headers({ 'idempotency-key': crypto.randomUUID() });
  if (options.version !== undefined) headers.set('if-match', String(options.version));
  if (options.reason) headers.set('x-memoryv4-reason', options.reason);
  return api<T>(path, {
    method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

export interface HermesCollection<T extends Record<string, unknown>> {
  items: T[];
  meta: {
    owner: 'hermes';
    frameworkId: string;
    sourceVersion: string;
    generatedAt: string;
  };
  page: { hasMore: boolean; nextCursor?: string };
}

export const gateway = {
  me: () => api<Principal>('/auth/me'),
  login: (username: string, password: string) =>
    api<Principal>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, deviceLabel: 'UNIUI browser' }),
    }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),

  hermesWorkspaces: (frameworkId: string) =>
    api<HermesCollection<Record<string, unknown>>>(`/frameworks/${encodeURIComponent(frameworkId)}/work/workspaces?limit=500`),
  hermesProjects: (frameworkId: string) =>
    api<HermesCollection<Record<string, unknown>>>(
      `/frameworks/${encodeURIComponent(frameworkId)}/work/projects?limit=500`,
    ),
  hermesBoards: (frameworkId: string) =>
    api<HermesCollection<Record<string, unknown>>>(
      `/frameworks/${encodeURIComponent(frameworkId)}/work/boards?limit=500`,
    ),
  hermesTasks: (frameworkId: string, boardId: string) =>
    api<HermesCollection<Record<string, unknown>>>(
      `/frameworks/${encodeURIComponent(frameworkId)}/work/boards/${encodeURIComponent(boardId)}/tasks?limit=500`,
    ),
  hermesCronjobs: (frameworkId: string) =>
    api<HermesCollection<Record<string, unknown>>>(
      `/frameworks/${encodeURIComponent(frameworkId)}/work/cronjobs?limit=500`,
    ),
  hermesProfiles: (frameworkId: string) =>
    api<HermesCollection<Record<string, unknown>>>(
      `/frameworks/${encodeURIComponent(frameworkId)}/profiles?limit=500`,
    ),
  federationLeases: () => api<FederationLeaseCollection>('/federation/leases?limit=500'),
  createFederationLease: (request: FederationLeaseRequest, idempotencyKey: string) =>
    api<FederationLeaseResponse>('/federation/leases', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(request),
    }),
  mutate: (request: MutationRequest, idempotencyKey: string = crypto.randomUUID()) =>
    api<MutationResponse>('/mutations', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(request),
    }),
};
