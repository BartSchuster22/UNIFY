export type FederationLeaseStatus = 'pending' | 'running' | 'completed' | 'failed';

export type FederationLeaseStage =
  | 'pending'
  | 'source-started'
  | 'worker-running'
  | 'worker-completed'
  | 'source-completed'
  | 'source-blocked';

export interface FederationLeaseRecord {
  id: string;
  sourceFrameworkId: string;
  sourceBoardId: string;
  sourceTaskId: string;
  workerFrameworkId: string;
  workerBoardId: string;
  workerProfileId: string;
  workerTaskId: string | null;
  status: FederationLeaseStatus;
  stage: FederationLeaseStage;
  attempt: number;
  leaseExpiresAt: Date;
  heartbeatAt: Date;
  requestHash: string;
  result: unknown;
  error: unknown;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface FederationLeaseInput {
  actorUserId: string;
  idempotencyKey: string;
  sourceFrameworkId: string;
  sourceBoardId: string;
  sourceTaskId: string;
  sourceSourceVersion: string;
  workerFrameworkId: string;
  workerBoardId: string;
  workerProfileId: string;
  prompt: string;
  leaseTtlSeconds: number;
}

export type FederationClaimResult =
  | { kind: 'created'; lease: FederationLeaseRecord }
  | { kind: 'replayed'; lease: FederationLeaseRecord }
  | { kind: 'conflict'; lease: FederationLeaseRecord };

export interface FederationLeaseStore {
  ready(): Promise<boolean>;
  claim(input: FederationLeaseInput & { requestHash: string }): Promise<FederationClaimResult>;
  get(id: string): Promise<FederationLeaseRecord | null>;
  list(limit: number): Promise<FederationLeaseRecord[]>;
  advance(
    id: string,
    stage: FederationLeaseStage,
    status: FederationLeaseStatus,
    patch?: { workerTaskId?: string; result?: unknown; error?: unknown },
  ): Promise<FederationLeaseRecord | null>;
}
