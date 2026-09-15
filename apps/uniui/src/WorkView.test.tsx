import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, gateway } from './api';
import { FrameworkProvider } from './FrameworkContext';
import { WorkView } from './WorkView';

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return { ...actual, api: vi.fn() };
});
const mockedApi = vi.mocked(api);

const meta = {
  owner: 'hermes' as const,
  frameworkId: 'hermes-alica',
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
    <MantineProvider env="test">
      <FrameworkProvider>
        <WorkView canManage={canManage} />
      </FrameworkProvider>
    </MantineProvider>,
  );
}

describe('UNIFY Work & Kanban', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?view=work');
    mockedApi.mockImplementation(async (path) => {
      if (path.endsWith('/capabilities'))
        return {
          data: { capabilities: { 'work.execute': { status: 'supported' } } },
        } as never;
      return {
        items: [
          {
            frameworkId: 'hermes-alica',
            displayName: 'Alica',
            enabled: true,
            status: 'verified',
          },
          {
            frameworkId: 'hermes-herman',
            displayName: 'Herman',
            enabled: true,
            status: 'verified',
          },
        ],
      } as never;
    });
    vi.spyOn(gateway, 'hermesWorkspaces').mockResolvedValue({ items: [{ id: '/qa/workspace', path: '/qa/workspace', root: '/qa/workspace', name: 'QA workspace' }], meta, page });
    vi.spyOn(gateway, 'hermesProfiles').mockResolvedValue({ items: [{ id: 'default', displayName: 'Coordinator', description: 'Manages projects' }, { id: 'builder', displayName: 'Builder', description: 'Builds artifacts' }], meta, page });
    vi.spyOn(gateway, 'hermesProjects').mockResolvedValue(projects);
    vi.spyOn(gateway, 'hermesBoards').mockResolvedValue(boards);
    vi.spyOn(gateway, 'hermesTasks').mockResolvedValue(tasks);
    vi.spyOn(gateway, 'hermesCronjobs').mockResolvedValue(cronjobs);
    vi.spyOn(gateway, 'mutate').mockResolvedValue({
      replayed: false,
      operation: {
        operationId: 'op-1',
        operationType: 'work.project.create',
        state: 'verified',
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

  it('renders native run results and cancels only the selected native run with confirmation', async () => {
    window.history.replaceState(null, '', '/work?workPage=board&project=alpha');
    vi.mocked(gateway.hermesTasks).mockResolvedValue({ ...tasks, items: [{ id: 'TASK-2', boardId: 'alpha', title: 'Running proof', status: 'running', runs: [{ id: 42, status: 'running', profile: 'builder', summary: 'Native progress proof', sessionId: 'session-proof', artifacts: ['/qa/output.json'] }] }] } as never);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWork();
    await screen.findByText('Native progress proof');
    expect(screen.getByText('session-proof')).toBeTruthy();
    expect(screen.getByText('/qa/output.json')).toBeTruthy();
    expect(screen.queryByRole('button', {name:'Block'})).toBeNull();
    fireEvent.click(await screen.findByRole('button', {name:'Cancel run'}));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalledWith(expect.objectContaining({ operationType:'work.task.cancel', confirmed:true, target:expect.objectContaining({frameworkId:'hermes-alica',nativeId:'TASK-2'}), payload:expect.objectContaining({boardId:'alpha',runId:42,expectedSourceVersion:'sha256:test'}) }), expect.any(String)));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('keeps last observed cards visible and disables mutations after a failed refresh', async () => {
    window.history.replaceState(null, '', '/work?workPage=board&project=alpha');
    renderWork();
    await screen.findByText('Running checks');
    vi.mocked(gateway.hermesTasks).mockRejectedValueOnce(new Error('Native temporarily unavailable'));
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
    await screen.findByText('Native temporarily unavailable');
    expect(screen.getByText('Running checks')).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Unblock'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
    await screen.findByRole('button',{name:'Unblock'});
    expect(gateway.mutate).not.toHaveBeenCalled();
  });

  it.each([
    ['project', 'Project name'], ['project', 'Project slug optional'],
    ['project', 'Project goal'],
    ['task', 'Task name'], ['task', 'Prompt'],
    ['cron', 'Cronjob name'], ['cron', 'Title'], ['cron', 'Prompt'], ['cron', 'Repeat interval'],
  ])('retains repeated input in %s / %s without retaining the event or submitting', async (kind, label) => {
    window.history.replaceState(null, '', '/?view=work&workPage=' + (kind === 'cron' ? 'cronjobs' : 'add'));
    renderWork();
    if (kind === 'cron') fireEvent.click(await screen.findByRole('button', { name: 'New Cronjob' }));
    if (kind === 'task') fireEvent.click(await screen.findByRole('radio', { name: 'Task' }));
    const field = await screen.findByRole('textbox', { name: label });
    for (const value of ['first pasted value', 'second pasted value', 'third edited value']) {
      fireEvent.change(field, { target: { value } });
      expect(field).toHaveValue(value);
    }
    expect(gateway.mutate).not.toHaveBeenCalled();
  });

  it('selects real workspace, manager and worker selections without manual IDs or activation', async () => {
    window.history.replaceState(null, '', '/work?workPage=add&framework=hermes-alica');
    renderWork();
    await waitFor(() => expect(screen.getByLabelText('Default workspace path', { selector: 'input' })).toBeEnabled());
    fireEvent.change(screen.getByRole('textbox', { name: /Project name/ }), { target: { value: 'QA selectors' } });
    fireEvent.click(screen.getByLabelText('Default workspace path', { selector: 'input' }));
    fireEvent.click(await screen.findByRole('option', { name: '/qa/workspace' }));
    fireEvent.click(screen.getByLabelText('Project manager agent', { selector: 'input' }));
    fireEvent.click(await screen.findByRole('option', { name: /Coordinator/ }));
    fireEvent.click(screen.getByLabelText('Worker agents', { selector: 'input' }));
    fireEvent.click(await screen.findByRole('option', { name: /Builder/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'work.project.create', target: expect.objectContaining({ frameworkId: 'hermes-alica' }),
      payload: expect.objectContaining({ defaultWorkspacePath: '/qa/workspace', projectManager: 'default', agents: ['builder'], startPmPlanning: false }),
    }), expect.any(String)));
    expect(gateway.hermesWorkspaces).toHaveBeenCalledWith('hermes-alica');
  });

  it('reopens the URL-selected project with persisted workspace/team and project-owned name', async () => {
    window.history.replaceState(null, '', '/work?workPage=details&framework=hermes-alica&project=beta');
    vi.mocked(gateway.hermesProjects).mockResolvedValue({ ...projects, items: [...projects.items, {
      id: 'beta', name: 'Beta', boardId: 'beta', archived: false,
      defaultWorkspacePath: '/qa/workspace', projectManager: 'default', agents: ['builder'],
    }] } as never);
    vi.mocked(gateway.hermesBoards).mockResolvedValue({ ...boards, items: [...boards.items, { id: 'beta', name: 'Board title must not override project', archived: false, counts: {}, total: 0 }] } as never);
    renderWork();
    await waitFor(() => expect(screen.getByLabelText('Default workspace path', { selector: 'input' })).toHaveValue('/qa/workspace'));
    expect(screen.getByLabelText('Project manager agent', { selector: 'input' })).toHaveValue('Coordinator (default) — Manages projects');
    expect(document.querySelector('.mantine-MultiSelect-root .mantine-Pill-label')?.textContent).toContain('Builder');
    expect(new URLSearchParams(window.location.search).get('project')).toBe('beta');
    expect(screen.getByRole('textbox', { name: /Project name/ })).toHaveValue('Beta');
  });

  it('fails closed when workspace inventory is unavailable', async () => {
    window.history.replaceState(null, '', '/work?workPage=add');
    vi.spyOn(gateway, 'hermesWorkspaces').mockRejectedValue(new Error('unavailable'));
    renderWork();
    expect(await screen.findByText(/Workspace or agent inventory unavailable/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Project name/ }), { target: { value: 'QA blocked' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(gateway.mutate).not.toHaveBeenCalled();
  });

  it('routes all authoritative Work reads to the exact URL-selected framework', async () => {
    window.history.replaceState(null, '', '/?view=work&framework=hermes-herman');
    renderWork();
    await screen.findByText('Blocked release');
    expect(gateway.hermesProjects).toHaveBeenCalledWith('hermes-herman');
    expect(gateway.hermesBoards).toHaveBeenCalledWith('hermes-herman');
    expect(gateway.hermesCronjobs).toHaveBeenCalledWith('hermes-herman');
    expect(gateway.hermesProjects).not.toHaveBeenCalledWith('hermes-alica');
    expect(mockedApi).toHaveBeenCalledWith('/frameworks/hermes-herman/capabilities');
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

  it('restores Work subsections from browser history', async () => {
    window.history.replaceState(null, '', '/work?framework=hermes-alica&workPage=overview');
    renderWork();
    await screen.findByRole('heading', { name: '2 items need attention' });

    fireEvent.click(screen.getByText('Kanban overview'));
    expect(await screen.findByRole('heading', { name: 'Kanban overview' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/work');
    expect(new URLSearchParams(window.location.search).get('workPage')).toBe('projects');

    window.history.replaceState(null, '', '/work?framework=hermes-alica&workPage=overview');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(
      await screen.findByRole('heading', { name: '2 items need attention' }),
    ).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Save and Start' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalled());
    expect(vi.mocked(gateway.mutate).mock.calls[0]?.[0]).toMatchObject({
      operationType: 'work.project.create',
      target: {
        owner: 'hermes',
        kind: 'project',
        nativeId: 'beta-project',
        frameworkId: 'hermes-alica',
      },
      payload: { name: 'Beta Project', startPmPlanning: false },
      mode: 'execute',
    });
  });

  it('pins task writes to the exact framework and authoritative task source version', async () => {
    window.history.replaceState(null, '', '/?view=work&workPage=board');
    renderWork();
    await screen.findByText('Blocked release');
    fireEvent.click(screen.getAllByRole('button', { name: 'Complete' })[0]!);
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalled());
    expect(vi.mocked(gateway.mutate).mock.calls[0]?.[0]).toMatchObject({
      operationType: 'work.task.complete',
      target: {
        owner: 'hermes',
        kind: 'task',
        nativeId: 'TASK-3',
        frameworkId: 'hermes-alica',
      },
      payload: { boardId: 'alpha', expectedSourceVersion: 'sha256:test' },
    });
  });

  it('fails work writes closed when Hermes reports the capability unavailable', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path.endsWith('/capabilities'))
        return {
          data: {
            capabilities: {
              'work.execute': { status: 'unavailable', reason: 'Hermes work owner offline' },
            },
          },
        } as never;
      return {
        items: [
          {
            frameworkId: 'hermes-alica',
            displayName: 'Alica',
            enabled: true,
            status: 'verified',
          },
        ],
      } as never;
    });
    window.history.replaceState(null, '', '/?view=work&workPage=cronjobs');
    renderWork();
    expect(
      await screen.findByRole('alert', { name: 'Native work mutations unavailable' }),
    ).toHaveTextContent('Hermes work owner offline');
    expect(screen.queryByRole('button', { name: 'New Cronjob' })).not.toBeInTheDocument();
    expect(gateway.mutate).not.toHaveBeenCalled();
  });

  it('creates only the bounded Alica to Herman lease from an exact authoritative card version', async () => {
    window.history.replaceState(null, '', '/?view=work&framework=hermes-alica');
    vi.spyOn(gateway, 'federationLeases').mockResolvedValue({ items: [] });
    vi.spyOn(gateway, 'hermesProfiles').mockResolvedValue({
      items: [
        {
          id: 'default',
          displayName: 'Herman default',
          owner: 'hermes',
          frameworkId: 'hermes-herman',
        },
      ],
      meta: { ...meta, frameworkId: 'hermes-herman' },
      page,
    });
    const create = vi.spyOn(gateway, 'createFederationLease').mockResolvedValue({
      replayed: false,
      lease: {
        id: 'lease-ui-1',
        source: { frameworkId: 'hermes-alica', boardId: 'alpha', taskId: 'TASK-3' },
        worker: {
          frameworkId: 'hermes-herman',
          boardId: 'native',
          profileId: 'default',
          taskId: null,
        },
        status: 'completed',
        stage: 'source-completed',
        attempt: 1,
        leaseExpiresAt: '2026-08-25T00:00:00.000Z',
        heartbeatAt: '2026-08-24T23:00:00.000Z',
        createdAt: '2026-08-24T22:00:00.000Z',
        updatedAt: '2026-08-24T23:00:00.000Z',
      },
    });

    renderWork();
    await screen.findByText('Blocked release');
    fireEvent.click(screen.getByRole('radio', { name: 'Alica → Herman' }));
    expect(await screen.findByText('Bounded Alica → Herman delegation')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('New intake')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I confirm this exact Alica card and Herman profile delegation',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delegate exact card' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toEqual({
      sourceFrameworkId: 'hermes-alica',
      sourceBoardId: 'alpha',
      sourceTaskId: 'TASK-3',
      sourceSourceVersion: 'sha256:test',
      workerFrameworkId: 'hermes-herman',
      workerProfileId: 'default',
      prompt: 'New intake',
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('result');
    expect(create.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      await screen.findByText(/lease-ui-1 reached completed\/source-completed/),
    ).toBeInTheDocument();
  });

  it('fails the federation UI closed when Herman is selected as the source', async () => {
    window.history.replaceState(null, '', '/?view=work&framework=hermes-herman');
    vi.spyOn(gateway, 'federationLeases').mockResolvedValue({ items: [] });
    vi.spyOn(gateway, 'hermesProfiles').mockResolvedValue({ items: [], meta, page });
    renderWork();
    await screen.findByText('Blocked release');
    fireEvent.click(screen.getByRole('radio', { name: 'Alica → Herman' }));
    expect(await screen.findByText('Select Alica as the source framework')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delegate exact card' })).toBeDisabled();
  });

  it('excludes terminal and unknown cron states from Active without hiding them from All', async () => {
    vi.spyOn(gateway, 'hermesCronjobs').mockResolvedValue({
      ...cronjobs,
      items: ['active', 'scheduled', 'running', 'completed', 'disabled', 'unknown'].map((status) => ({
        id: 'cron-' + status, name: 'Job ' + status, status, schedule: 'once', deliver: ['local'],
      })),
    });
    window.history.replaceState(null, '', '/?view=work&workPage=cronjobs');
    renderWork();
    expect(await screen.findByText('Job completed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Active 3' }));
    expect(screen.queryByText('Job completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Job disabled')).not.toBeInTheDocument();
    expect(screen.queryByText('Job unknown')).not.toBeInTheDocument();
    expect(screen.getByText('Job active')).toBeInTheDocument();
    expect(screen.getByText('Job scheduled')).toBeInTheDocument();
    expect(screen.getByText('Job running')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'All 6' }));
    expect(screen.getByText('Job completed')).toBeInTheDocument();
  });

  it('shows native cron controls and refuses browser-owned notification fallback truth', async () => {
    renderWork();
    await screen.findByText('Blocked release');
    fireEvent.click(screen.getByRole('radio', { name: 'Cronjobs' }));
    expect(await screen.findByRole('heading', { name: 'Cronjobs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Cronjob' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Settings' }));
    expect(
      await screen.findByRole('alert', { name: 'Authoritative notification settings unavailable' }),
    ).toHaveTextContent('does not expose notification-rule inventory or mutation');
    expect(screen.queryByLabelText('Telegram destination')).not.toBeInTheDocument();
    expect(localStorage.getItem('unify-work-notification-rules')).toBeNull();
  });
});
