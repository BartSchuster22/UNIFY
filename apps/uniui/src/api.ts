import type {
  ApiFailure,
  FederationLeaseCollection,
  FederationLeaseRequest,
  FederationLeaseResponse,
  MutationRequest,
  MutationResponse,
  Principal,
} from './types';

import { clearNavigationCache } from './navigationCache';

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
  const mutating = Boolean(init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()));
  if (mutating) clearNavigationCache();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body) headers.set('content-type', 'application/json');
  const csrf = csrfToken();
  if (csrf && init.method && init.method !== 'GET')
    headers.set('x-csrf-token', decodeURIComponent(csrf));
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: 'include',
  }).finally(() => {
    // Also discard reads that completed while a write was in flight.
    if (mutating) clearNavigationCache();
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) clearNavigationCache();
    const body = (await response.json().catch(() => ({}))) as { error?: ApiFailure };
    throw new ApiError(
      response.status,
      body.error ?? { code: 'REQUEST_FAILED', message: `Request failed (${response.status})` },
    );
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Upload transport reports bytes sent separately from server confirmation. */
export function apiUpload<T>(
  path: string,
  body: unknown,
  progress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  clearNavigationCache();
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1' + path);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    xhr.setRequestHeader('content-type', 'application/json');
    const csrf = csrfToken();
    if (csrf) xhr.setRequestHeader('x-csrf-token', decodeURIComponent(csrf));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((100 * e.loaded) / e.total));
    };
    const abort = () => xhr.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => {
      clearNavigationCache();
      signal?.removeEventListener('abort', abort);
    };
    xhr.onload = () => {
      cleanup();
      try {
        const value = JSON.parse(xhr.responseText);
        if (xhr.status < 200 || xhr.status >= 300)
          reject(
            new ApiError(
              xhr.status,
              value.error ?? {
                code: 'UPLOAD_FAILED',
                message: 'Upload failed; refresh to check the destination',
              },
            ),
          );
        else resolve(value);
      } catch {
        reject(new Error('Upload response invalid; refresh to inspect the destination'));
      }
    };
    xhr.onerror =
      xhr.ontimeout =
      xhr.onabort =
        () => {
          cleanup();
          reject(
            new Error(
              'Upload response lost or cancelled. Refresh the destination before retrying; the file may have been saved.',
            ),
          );
        };
    if (signal?.aborted) {
      cleanup();
      reject(new Error('Upload cancelled'));
      return;
    }
    xhr.send(JSON.stringify(body));
  });
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
    api<HermesCollection<Record<string, unknown>>>(
      `/frameworks/${encodeURIComponent(frameworkId)}/work/workspaces?limit=500`,
    ),
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
