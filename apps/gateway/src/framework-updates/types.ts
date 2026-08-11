export type UpdateRelation =
  'current' | 'update_available' | 'installed_ahead' | 'diverged' | 'unknown';

export interface DeploymentMetadataInput {
  frameworkId: string;
  releaseId: string;
  imageReference: string;
  imageDigest: string;
  frameworkVersion: string;
  frameworkCommit: string;
}

export interface DeploymentMetadata extends DeploymentMetadataInput {
  metadataSource: 'deployment-environment';
  recordedAt: string;
}

export interface TrustedRelease {
  tagName: string;
  releaseName: string;
  commitSha: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  prerelease: boolean;
  draft: boolean;
}

export interface StoredUpdateCandidate extends TrustedRelease {
  candidateId: string;
  sourceId: string;
  discoveredAt: string;
}

export interface StoredComparison {
  frameworkId: string;
  candidateId: string;
  relation: UpdateRelation;
  githubStatus: 'identical' | 'behind' | 'ahead' | 'diverged' | 'unknown';
  aheadBy: number;
  behindBy: number;
  checkedAt: string;
}

export interface CandidateAssessment {
  assessmentId: string;
  candidateId: string;
  state: 'ready' | 'blocked';
  sourceCommit: string;
  sourceArchiveDigest: string;
  imageReference?: string;
  imageDigest?: string;
  adapterRelease: string;
  contractVersion: string;
  contractPassed: boolean;
  acceptancePassed: boolean;
  evidence: Record<string, unknown>;
  evidenceDigest: string;
  safeFailureCode?: string;
  safeFailureReason?: string;
  assessedAt: string;
  recordedAt: string;
}

export interface FrameworkReleasePolicy {
  canaryFrameworkId: 'hermes-alica' | 'hermes-herman';
  observationWindowSeconds: number;
  requiredHealthySamples: number;
  manualPromotionRequired: true;
  updatedBy?: string;
  updatedAt: string;
}

export type RolloutPlanState =
  | 'planned'
  | 'dry_run_passed'
  | 'approved'
  | 'queued'
  | 'executing'
  | 'observing'
  | 'awaiting_promotion'
  | 'succeeded'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type RolloutTargetState =
  | 'planned'
  | 'dry_run_passed'
  | 'pending'
  | 'awaiting_promotion'
  | 'executing'
  | 'converged'
  | 'failed'
  | 'cancelled';

export interface FrameworkRolloutTarget {
  frameworkId: 'hermes-alica' | 'hermes-herman';
  ordinal: number;
  state: RolloutTargetState;
  previousReleaseId: string;
  previousImageReference: string;
  previousImageDigest: string;
  previousFrameworkVersion: string;
  previousFrameworkCommit: string;
  targetReleaseId: string;
  targetImageReference: string;
  targetImageDigest: string;
  targetFrameworkVersion: string;
  targetFrameworkCommit: string;
  progress: number;
  dryRunChecks: Record<string, unknown>;
  convergenceChecks: Record<string, unknown>;
  observationChecks: Record<string, unknown>;
  safeErrorCode?: string;
  safeErrorReason?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface FrameworkRolloutPlan {
  planId: string;
  candidateId: string;
  assessmentId: string;
  state: RolloutPlanState;
  operationKind: 'release' | 'rollback';
  sourcePlanId?: string;
  policySnapshot: Record<string, unknown>;
  rollbackReason?: string;
  createdBy: string;
  approvedBy?: string;
  createdAt: string;
  dryRunAt?: string;
  approvedAt?: string;
  executionRequestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  observationStartedAt?: string;
  observationDeadlineAt?: string;
  observationCompletedAt?: string;
  promotedBy?: string;
  promotedAt?: string;
  failureCode?: string;
  failureReason?: string;
  targets: FrameworkRolloutTarget[];
  events: Array<{
    eventId: string;
    frameworkId?: string;
    state: string;
    progress: number;
    safeMessage: string;
    details: Record<string, unknown>;
    occurredAt: string;
  }>;
  observations: Array<{
    observationId: string;
    frameworkId: string;
    healthy: boolean;
    imageIdentity: boolean;
    releaseIdentity: boolean;
    commitIdentity: boolean;
    details: Record<string, unknown>;
    observedAt: string;
  }>;
}

export interface UpdateSourceState {
  sourceId: string;
  repository: string;
  trusted: true;
  lastCheckedAt?: string;
  lastSuccessAt?: string;
  safeError?: string;
}

export interface FrameworkUpdateStore {
  ready(): Promise<boolean>;
  reconcileDeployments(items: readonly DeploymentMetadataInput[]): Promise<void>;
  recordDiscoverySuccess(
    sourceId: string,
    repository: string,
    release: TrustedRelease,
    comparisons: readonly Omit<StoredComparison, 'candidateId' | 'checkedAt'>[],
  ): Promise<StoredUpdateCandidate>;
  recordDiscoveryFailure(sourceId: string, repository: string, safeError: string): Promise<void>;
  createRolloutPlan(
    actorUserId: string,
    frameworkIds: readonly string[],
  ): Promise<FrameworkRolloutPlan>;
  dryRunRollout(planId: string): Promise<FrameworkRolloutPlan>;
  approveRollout(planId: string, actorUserId: string): Promise<FrameworkRolloutPlan>;
  queueRollout(planId: string): Promise<FrameworkRolloutPlan>;
  promoteRollout(planId: string, actorUserId: string): Promise<FrameworkRolloutPlan>;
  createRollback(
    sourcePlanId: string,
    actorUserId: string,
    reason: string,
  ): Promise<FrameworkRolloutPlan>;
  releasePolicy(): Promise<FrameworkReleasePolicy>;
  updateReleasePolicy(
    actorUserId: string,
    input: Pick<
      FrameworkReleasePolicy,
      'canaryFrameworkId' | 'observationWindowSeconds' | 'requiredHealthySamples'
    >,
  ): Promise<FrameworkReleasePolicy>;
  rollout(planId: string): Promise<FrameworkRolloutPlan | null>;
  listRollouts(limit?: number): Promise<FrameworkRolloutPlan[]>;
  snapshot(): Promise<{
    source: UpdateSourceState;
    candidate: StoredUpdateCandidate | null;
    assessment: CandidateAssessment | null;
    frameworks: Array<{
      frameworkId: string;
      displayName: string;
      deployment: DeploymentMetadata | null;
      comparison: StoredComparison | null;
    }>;
  }>;
}

export interface TrustedReleaseClient {
  latestStableRelease(): Promise<TrustedRelease>;
  compare(
    installedCommit: string,
    candidateTag: string,
  ): Promise<{
    status: 'identical' | 'behind' | 'ahead' | 'diverged' | 'unknown';
    aheadBy: number;
    behindBy: number;
  }>;
}
