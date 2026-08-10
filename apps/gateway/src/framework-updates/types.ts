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
  snapshot(): Promise<{
    source: UpdateSourceState;
    candidate: StoredUpdateCandidate | null;
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
