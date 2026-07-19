export type OperationState =
  | 'pending'
  | 'validated'
  | 'preflighted'
  | 'awaiting_confirmation'
  | 'executing'
  | 'applied'
  | 'verifying'
  | 'verified'
  | 'denied'
  | 'failed'
  | 'inconclusive'
  | 'rolling_back'
  | 'rolled_back'
  | 'rollback_failed';
export type OperationMode = 'validate' | 'dry-run' | 'execute' | 'verify' | 'rollback';
export interface OperationRecord {
  id: string;
  actorUserId: string;
  action: string;
  targetFramework: string | null;
  targetKind: string | null;
  targetId: string | null;
  state: OperationState;
  mode: OperationMode;
  policyDecision: 'pending' | 'allowed' | 'denied';
  sourceVersion: string | null;
  requestHash: string;
  idempotencyKey: string;
  result: unknown;
  error: unknown;
  evidenceIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
export interface NewOperation {
  actorUserId: string;
  action: string;
  targetFramework: string;
  targetKind: string;
  targetId: string;
  mode?: OperationMode;
  policyDecision?: 'pending' | 'allowed' | 'denied';
  sourceVersion?: string;
  requestHash: string;
  idempotencyKey: string;
}
export type ClaimResult =
  | { kind: 'created' | 'replayed'; operation: OperationRecord }
  | { kind: 'conflict'; operationId: string };
export interface EvidenceInput {
  operationId?: string;
  kind: string;
  sha256: string;
  storageUri: string;
  redactedPayload: unknown;
  metadata: Record<string, unknown>;
}
export interface AuditInput {
  actorUserId?: string;
  sessionId?: string;
  action: string;
  target?: Record<string, unknown>;
  outcome: string;
  requestId?: string;
  ipHash?: string;
  details?: Record<string, unknown>;
}
export interface GovernanceStore {
  ready(): Promise<boolean>;
  claimOperation(
    scope: string,
    key: string,
    operation: NewOperation,
    expiresAt: Date,
  ): Promise<ClaimResult>;
  getOperation(operationId: string): Promise<OperationRecord | null>;
  transition(
    operationId: string,
    from: OperationState,
    to: OperationState,
    result?: unknown,
    error?: unknown,
  ): Promise<OperationRecord | null>;
  addEvidence(input: EvidenceInput): Promise<string>;
  appendAudit(input: AuditInput): Promise<string>;
}
