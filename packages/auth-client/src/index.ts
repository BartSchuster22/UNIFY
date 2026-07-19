export interface ApiFailure {
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
}

export interface Principal {
  userId: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export interface ResourceRef {
  canonicalId: string;
  kind: string;
  owner: string;
  nativeId: string;
  observedAt: string;
  displayLabel?: string;
  sourceVersion?: string;
}

export interface UnifiedResource {
  resource: ResourceRef;
  truth: string;
  authoritative: true;
  adapterId: string;
  fetchedAt: string;
  title: string;
  searchableText: string;
  data: Record<string, unknown>;
}

export interface Collection<T> {
  items: T[];
  meta?: {
    requestId: string;
    freshness: string;
    warnings: Array<{ code: string; message: string }>;
    page?: { nextCursor?: string; hasMore: boolean };
  };
}

export interface UnifiedNotification {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  source: string;
  state: 'unread' | 'read' | 'acknowledged';
  createdAt: string;
  deepLink?: string;
  resource?: ResourceRef;
}

export interface MutationRequest {
  operationType: string;
  target: {
    owner: 'hermes' | 'dmm' | 'worker' | 'chat' | 'memory-v4';
    kind: string;
    nativeId: string;
    frameworkId?: string;
  };
  payload: Record<string, unknown>;
  mode: 'validate' | 'dry-run' | 'execute';
  confirmed: boolean;
}

export interface MutationResponse {
  replayed: boolean;
  operation: { operationId: string; operationType: string; state: string; updatedAt: string };
  result: unknown;
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly failure: ApiFailure,
  ) {
    super(failure.message);
  }
}

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const raw = document.cookie
    .split('; ')
    .find((part) => part.startsWith('aquiero_csrf='))
    ?.split('=')
    .slice(1)
    .join('=');
  return raw ? decodeURIComponent(raw) : undefined;
}

export class GatewayClient {
  constructor(
    readonly baseUrl = '/api/v1',
    readonly deviceLabel = 'Aquiero browser',
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body && !(init.body instanceof FormData))
      headers.set('content-type', 'application/json');
    const csrf = csrfToken();
    if (csrf && init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase()))
      headers.set('x-csrf-token', csrf);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: ApiFailure };
      throw new GatewayError(
        response.status,
        body.error ?? { code: 'REQUEST_FAILED', message: `Request failed (${response.status})` },
      );
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
  }

  me() {
    return this.request<Principal>('/auth/me');
  }
  login(username: string, password: string) {
    return this.request<Principal>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, deviceLabel: this.deviceLabel }),
    });
  }
  logout() {
    return this.request<void>('/auth/logout', { method: 'POST' });
  }
  resources(query: URLSearchParams) {
    return this.request<Collection<UnifiedResource>>(`/resources?${query}`);
  }
  notifications(query = new URLSearchParams({ limit: '200' })) {
    return this.request<Collection<UnifiedNotification>>(`/notifications?${query}`);
  }
  acknowledgeNotification(id: string) {
    return this.request<void>(`/notifications/${encodeURIComponent(id)}/acknowledge`, {
      method: 'POST',
    });
  }
  collection<T>(path: string) {
    return this.request<Collection<T>>(path);
  }
  mutate(request: MutationRequest, idempotencyKey: string = crypto.randomUUID()) {
    return this.request<MutationResponse>('/mutations', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(request),
    });
  }
  chatDownloadUrl(path: string) {
    return `${this.baseUrl}/chat/download?path=${encodeURIComponent(path)}`;
  }
}

export function registerPwa(): void {
  if ('serviceWorker' in navigator)
    window.addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
