import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { FrameworkUpdatesView, type FrameworkUpdateSnapshot } from './FrameworkUpdatesView';

vi.mock('./api', () => ({ api: vi.fn() }));
const mockedApi = vi.mocked(api);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const snapshot: FrameworkUpdateSnapshot = {
  mode: 'read-only',
  source: {
    sourceId: 'hermes-agent',
    repository: 'NousResearch/hermes-agent',
    trusted: true,
    lastCheckedAt: '2026-08-10T10:00:00.000Z',
    lastSuccessAt: '2026-08-10T10:00:00.000Z',
  },
  latestCandidate: {
    candidateId: `fuc_${'1'.repeat(64)}`,
    tagName: 'v2026.8.3',
    releaseName: 'v2026.8.3',
    commitSha: '7de39e700d2c329e15d32eb0b96e2f7cdd9fbdb2',
    releaseUrl: 'https://github.com/NousResearch/hermes-agent/releases/tag/v2026.8.3',
    releaseNotes: 'Security and reliability improvements.',
    publishedAt: '2026-08-03T16:57:52.000Z',
    discoveredAt: '2026-08-10T10:00:00.000Z',
  },
  candidateAssessment: {
    assessmentId: `fca_${'3'.repeat(64)}`,
    state: 'ready',
    sourceCommit: '7de39e700d2c329e15d32eb0b96e2f7cdd9fbdb2',
    sourceArchiveDigest: `sha256:${'4'.repeat(64)}`,
    imageReference: `localhost:5000/unify/hermes-candidate@sha256:${'5'.repeat(64)}`,
    imageDigest: `sha256:${'5'.repeat(64)}`,
    adapterRelease: 'phase-20.0',
    contractVersion: 'hermes-control/v1',
    contractPassed: true,
    acceptancePassed: true,
    evidenceDigest: `sha256:${'6'.repeat(64)}`,
    assessedAt: '2026-08-10T12:00:00.000Z',
  },
  frameworks: [
    {
      frameworkId: 'hermes-herman',
      displayName: 'Herman',
      currentDeployment: {
        releaseId: 'phase-19.2-6a9373f',
        imageReference: `localhost:5000/unify/hermes-runtime@sha256:${'2'.repeat(64)}`,
        imageDigest: `sha256:${'2'.repeat(64)}`,
        frameworkVersion: '0.20.0',
        frameworkCommit: 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
        recordedAt: '2026-08-10T10:00:00.000Z',
      },
      comparison: {
        relation: 'update_available',
        aheadBy: 81,
        behindBy: 0,
        checkedAt: '2026-08-10T10:00:00.000Z',
      },
      compatibility: {
        status: 'compatible',
        reason:
          'Candidate passed hermes-control/v1 contract and isolated runtime acceptance tests.',
      },
    },
  ],
};

describe('FrameworkUpdatesView', () => {
  it('shows trusted release, deployed artifact, comparison and truthful compatibility state', async () => {
    mockedApi.mockResolvedValue(snapshot as never);
    render(
      <MantineProvider>
        <FrameworkUpdatesView />
      </MantineProvider>,
    );
    expect(await screen.findByText('Herman')).toBeInTheDocument();
    expect(screen.getByText('NousResearch/hermes-agent')).toBeInTheDocument();
    expect(screen.getAllByText('v2026.8.3').length).toBeGreaterThan(0);
    expect(screen.getByText('phase-19.2-6a9373f')).toBeInTheDocument();
    expect(screen.getByText('update available')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeInTheDocument();
    expect(screen.getByText('Candidate is ready for approval review')).toBeInTheDocument();
    expect(screen.getByText(/Candidate passed hermes-control\/v1/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deploy/i })).not.toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith('/framework-updates');
  });
});
