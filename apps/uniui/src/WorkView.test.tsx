import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateway } from './api';
import type { UnifiedResource } from './types';
import { WorkView } from './WorkView';

function resource(
  kind: string,
  nativeId: string,
  title: string,
  data: Record<string, unknown>,
): UnifiedResource {
  return {
    resource: {
      canonicalId: `worker:${kind}:${nativeId}`,
      kind,
      owner: 'worker',
      nativeId,
      observedAt: '2026-07-20T12:00:00.000Z',
    },
    truth: 'current',
    authoritative: true,
    adapterId: 'worker-read-v1',
    fetchedAt: '2026-07-20T12:00:00.000Z',
    title,
    searchableText: title,
    data,
  };
}

const items = [
  resource('project', 'alpha', 'Alpha', {
    slug: 'alpha',
    name: 'Alpha',
    description: 'Ship Alpha safely',
    lifecycleState: 'active',
    defaultWorkspacePath: '/srv/alpha',
    defaultAgents: { pm: 'Herman' },
    agentTeam: [{ name: 'Herman', role: 'Project manager agent', isProjectManager: true }],
  }),
  resource('kanban-board', 'alpha', 'Alpha', {
    slug: 'alpha',
    name: 'Alpha',
    description: 'Ship Alpha safely',
    status: 'active',
    countsByLane: { triage: 1, todo: 0, ready: 0, running: 1, blocked: 1, done: 0, archived: 0 },
  }),
  resource('task', 'TASK-1', 'Blocked release', {
    nativeId: 'TASK-1',
    board: 'alpha',
    lane: 'blocked',
    blockedReason: 'Needs approval',
  }),
  resource('task', 'TASK-2', 'Running checks', {
    nativeId: 'TASK-2',
    board: 'alpha',
    lane: 'running',
    assignee: 'Herman',
  }),
  resource('task', 'TASK-3', 'New intake', { nativeId: 'TASK-3', board: 'alpha', lane: 'triage' }),
  resource('cronjob', 'cron-1', 'Daily checks', {
    nativeId: 'cron-1',
    status: 'paused',
    paused: true,
    schedule: { kind: 'every', every: 'every 1d' },
  }),
];

function renderWork(canManage = true) {
  return render(
    <MantineProvider>
      <WorkView canManage={canManage} />
    </MantineProvider>,
  );
}

describe('UNIFY Work & Kanban', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?view=work');
    vi.spyOn(gateway, 'resources').mockResolvedValue({
      items,
      meta: {
        requestId: 'r1',
        freshness: 'current',
        generatedAt: '2026-07-20T12:00:00.000Z',
        observedAt: '2026-07-20T12:00:00.000Z',
        warnings: [],
      },
    });
    vi.spyOn(gateway, 'mutate').mockResolvedValue({
      replayed: false,
      operation: {
        operationId: 'op-1',
        operationType: 'worker.project.create',
        state: 'succeeded',
        mode: 'execute',
        updatedAt: '2026-07-20T12:00:00.000Z',
      },
      result: { ok: true },
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows the Worker operational attention, Kanban and Cronjobs overview', async () => {
    renderWork();
    expect(
      await screen.findByRole('heading', { name: '2 items need attention' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1 running' })).toBeInTheDocument();
    expect(screen.getByText('Blocked release')).toBeInTheDocument();
    expect(screen.getByText('Daily checks')).toBeInTheDocument();
  });

  it('provides project overview, a complete TTRRBDA project board, and editable setup', async () => {
    renderWork();
    await screen.findByText('Blocked release');
    fireEvent.click(screen.getByText('Kanban overview'));
    expect(await screen.findByRole('heading', { name: 'Kanban overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alpha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Kanban' }));
    for (const lane of ['TRIAGE', 'TODO', 'READY', 'RUNNING', 'BLOCKED', 'DONE', 'ARCHIVED']) {
      expect(await screen.findByText(lane)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Project setup' }));
    expect(await screen.findByDisplayValue('Ship Alpha safely')).toBeInTheDocument();
    expect(screen.getByDisplayValue('/srv/alpha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save project setup' })).toBeInTheDocument();
  });

  it('creates projects through governed Worker mutations and enforces Save versus Save and Start fields', async () => {
    window.history.replaceState(null, '', '/?view=work&workPage=add');
    renderWork();
    const name = await screen.findByRole('textbox', { name: /Project name/ });
    fireEvent.change(name, { target: { value: 'Beta Project' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save and Start' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalled());
    expect(vi.mocked(gateway.mutate).mock.calls[0]?.[0]).toMatchObject({
      operationType: 'worker.project.create',
      target: { owner: 'worker', kind: 'project', nativeId: 'beta-project' },
      payload: { name: 'Beta Project', startPmPlanning: false },
      mode: 'execute',
    });
  });

  it('shows native cron controls and persists notification rules in Settings', async () => {
    renderWork();
    await screen.findByText('Blocked release');
    fireEvent.click(screen.getByRole('radio', { name: 'Cronjobs' }));
    expect(await screen.findByRole('heading', { name: 'Cronjobs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Cronjob' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Settings' }));
    expect(
      await screen.findByRole('heading', { name: 'Notification rules setup' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Telegram notifications'));
    fireEvent.change(screen.getByLabelText('Telegram destination'), {
      target: { value: '1371039817' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save notification rules' }));
    expect(
      JSON.parse(localStorage.getItem('unify-worker-notification-rules') ?? '{}'),
    ).toMatchObject({ telegram: true, telegramDestination: '1371039817' });
  });
});
