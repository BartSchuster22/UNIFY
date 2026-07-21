import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateway } from './api';
import { WorkView } from './WorkView';

const meta = {
  owner: 'hermes' as const,
  frameworkId: 'hermes-main',
  sourceVersion: 'sha256:test',
  generatedAt: '2026-07-20T12:00:00.000Z',
};
const page = { hasMore: false };
const projects = {
  items: [
    {
      id: 'alpha',
      name: 'Alpha',
      description: 'Ship Alpha safely',
      boardId: 'alpha',
      archived: false,
    },
  ],
  meta,
  page,
};
const boards = {
  items: [
    {
      id: 'alpha',
      name: 'Alpha',
      archived: false,
      isCurrent: true,
      counts: { triage: 1, running: 1, blocked: 1 },
      total: 3,
    },
  ],
  meta,
  page,
};
const tasks = {
  items: [
    { id: 'TASK-1', boardId: 'alpha', title: 'Blocked release', status: 'blocked' },
    {
      id: 'TASK-2',
      boardId: 'alpha',
      title: 'Running checks',
      status: 'running',
      assignee: 'Herman',
    },
    { id: 'TASK-3', boardId: 'alpha', title: 'New intake', status: 'triage' },
  ],
  meta,
  page,
};
const cronjobs = {
  items: [
    {
      id: 'cron-1',
      name: 'Daily checks',
      status: 'paused',
      schedule: 'every 1440m',
      deliver: ['local'],
    },
  ],
  meta,
  page,
};

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
    vi.spyOn(gateway, 'hermesProjects').mockResolvedValue(projects);
    vi.spyOn(gateway, 'hermesBoards').mockResolvedValue(boards);
    vi.spyOn(gateway, 'hermesTasks').mockResolvedValue(tasks);
    vi.spyOn(gateway, 'hermesCronjobs').mockResolvedValue(cronjobs);
    vi.spyOn(gateway, 'mutate').mockResolvedValue({
      replayed: false,
      operation: {
        operationId: 'op-1',
        operationType: 'work.project.create',
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

  it('shows Hermes operational attention, Kanban and Cronjobs overview', async () => {
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
    expect(await screen.findByDisplayValue('Ship Alpha safely')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save project setup' })).toBeInTheDocument();
  });

  it('creates projects through governed Hermes mutations and enforces Save versus Save and Start fields', async () => {
    window.history.replaceState(null, '', '/?view=work&workPage=add');
    renderWork();
    const name = await screen.findByRole('textbox', { name: /Project name/ });
    fireEvent.change(name, { target: { value: 'Beta Project' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save and Start' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalled());
    expect(vi.mocked(gateway.mutate).mock.calls[0]?.[0]).toMatchObject({
      operationType: 'work.project.create',
      target: {
        owner: 'hermes',
        kind: 'project',
        nativeId: 'beta-project',
        frameworkId: 'hermes-main',
      },
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
