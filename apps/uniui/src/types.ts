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
export interface MutationRequest {
  operationType: string;
  target: {
    owner: 'hermes';
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
  operation: {
    operationId: string;
    operationType: string;
    state: string;
    mode: string;
    updatedAt: string;
  };
  result: unknown;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface MemoryEntityRef {
  entity_type: string;
  id: string;
}

export interface MemoryEntity extends MemoryEntityRef {
  name: string;
  scope_path: string;
  attrs: Record<string, unknown>;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  role: 'canonical' | 'active' | 'evidence' | 'exhaust';
  lifecycle: 'live' | 'working' | 'superseded' | 'archived' | 'expired';
  write_policy: 'team_editable' | 'author_only' | 'admin_only' | 'immutable';
  scope_path: string;
  entity: MemoryEntityRef | null;
  topic: string | null;
  tags: string[];
  confidence: number | null;
  source_refs: string[];
  provenance: Record<string, unknown>;
  attrs: Record<string, unknown>;
  author_actor: string;
  version: number;
  supersedes: string | null;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryObjectRef {
  kind: 'entity' | 'record' | 'artifact';
  id: string;
  entity_type?: string;
}

export interface MemoryRelation {
  id: string;
  from: MemoryObjectRef;
  to: MemoryObjectRef;
  relation_type: string;
  scope_path: string;
  author_actor: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryArtifact {
  id: string;
  record_id: string | null;
  entity: MemoryEntityRef | null;
  artifact_type: string;
  uri: string;
  checksum: string | null;
  scope_path: string;
  author_actor: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface MemoryAuditEvent {
  id: number;
  action: string;
  object_type: string;
  object_id: string;
  actor: string;
  scope_path: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface MemoryRetrievalEvent {
  id: number;
  query: string;
  scope_path: string;
  actor: string;
  result_count: number;
  degraded: boolean;
  created_at: string;
}
