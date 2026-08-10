import { describe, expect, it, vi } from 'vitest';
import { FrameworkUpdateVisibilityService } from './service.js';
import type {
  FrameworkUpdateStore,
  StoredComparison,
  StoredUpdateCandidate,
  TrustedRelease,
} from './types.js';

const release: TrustedRelease = {
  tagName: 'v2026.8.3',
  releaseName: 'v2026.8.3',
  commitSha: '3c27eb6234bf91b8ceee9e9071591b31e9b148cb',
  releaseUrl: 'https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3',
  releaseNotes: 'Release notes',
  publishedAt: '2026-08-03T16:57:52.000Z',
  prerelease: false,
  draft: false,
};

function fixture() {
  let candidate: StoredUpdateCandidate | null = null;
  let comparison: StoredComparison | null = null;
  const deployment = {
    frameworkId: 'hermes-herman',
    releaseId: 'phase-19.2',
    imageReference: `registry/hermes@sha256:${'2'.repeat(64)}`,
    imageDigest: `sha256:${'2'.repeat(64)}`,
    frameworkVersion: '0.20.0',
    frameworkCommit: 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
    metadataSource: 'deployment-environment' as const,
    recordedAt: '2026-08-10T10:00:00.000Z',
  };
  const store: FrameworkUpdateStore = {
    ready: vi.fn(async () => true),
    reconcileDeployments: vi.fn(async () => undefined),
    recordDiscoveryFailure: vi.fn(async () => undefined),
    recordDiscoverySuccess: vi.fn(async (sourceId, _repository, found, comparisons) => {
      const stored: StoredUpdateCandidate = {
        ...found,
        candidateId: `fuc_${'1'.repeat(64)}`,
        sourceId,
        discoveredAt: '2026-08-10T10:00:00.000Z',
      };
      candidate = stored;
      comparison = {
        ...comparisons[0],
        candidateId: stored.candidateId,
        checkedAt: '2026-08-10T10:00:00.000Z',
      };
      return stored;
    }),
    snapshot: vi.fn(async () => ({
      source: {
        sourceId: 'hermes-agent',
        repository: 'NousResearch/hermes-agent',
        trusted: true as const,
      },
      candidate,
      assessment: null,
      frameworks: [
        {
          frameworkId: 'hermes-herman',
          displayName: 'Herman',
          deployment,
          comparison,
        },
      ],
    })),
  };
  const client = {
    latestStableRelease: vi.fn(async () => release),
    compare: vi.fn(async () => ({ status: 'ahead' as const, aheadBy: 81, behindBy: 0 })),
  };
  const service = new FrameworkUpdateVisibilityService({
    sourceId: 'hermes-agent',
    repository: 'NousResearch/hermes-agent',
    deployments: [deployment],
    store,
    client,
  });
  return { service, store, client };
}

describe('FrameworkUpdateVisibilityService', () => {
  it('stores trusted discovery and exposes an unassessed update without mutation controls', async () => {
    const { service, store, client } = fixture();
    await service.refresh();
    const result = await service.snapshot();
    expect(client.compare).toHaveBeenCalledWith(
      'b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
      'v2026.8.3',
    );
    expect(store.recordDiscoverySuccess).toHaveBeenCalled();
    expect(result.mode).toBe('read-only');
    expect(result.frameworks[0]?.comparison?.relation).toBe('update_available');
    expect(result.frameworks[0]?.compatibility.status).toBe('not_assessed');
    expect(result).not.toHaveProperty('actions');
  });

  it('records a safe degraded state instead of failing startup discovery', async () => {
    const { service, store, client } = fixture();
    client.latestStableRelease.mockRejectedValueOnce(new Error('network internals'));
    await expect(service.refresh()).resolves.toBeUndefined();
    expect(store.recordDiscoveryFailure).toHaveBeenCalledWith(
      'hermes-agent',
      'NousResearch/hermes-agent',
      'Trusted upstream release discovery failed',
    );
  });
});
