export type TruthState =
  | 'current'
  | 'stale'
  | 'partial'
  | 'empty'
  | 'unavailable'
  | 'unsupported'
  | 'forbidden'
  | 'failed'
  | 'inconclusive';

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
  truth: TruthState;
  authoritative: true;
  adapterId: string;
  fetchedAt: string;
  title: string;
  searchableText: string;
  data: Record<string, unknown>;
}
export interface Warning {
  code: string;
  message: string;
}
export interface ResponseMeta {
  requestId: string;
  freshness: TruthState;
  observedAt?: string;
  generatedAt: string;
  warnings: Warning[];
  page?: { nextCursor?: string; hasMore: boolean };
}
export interface Collection<T> {
  items: T[];
  meta?: ResponseMeta;
}
export interface ApiFailure {
  code: string;
  message: string;
  requestId?: string;
  retryable?: boolean;
}
export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}
