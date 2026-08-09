import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, memoryMutation } from './api';
import { MemoryView } from './MemoryView';
import type { MemoryEntity, MemoryRecord } from './types';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return { ...original, api: vi.fn(), memoryMutation: vi.fn() };
});
const mockedApi = vi.mocked(api);
const mockedMemoryMutation = vi.mocked(memoryMutation);

const record: MemoryRecord = {
  id: 'rec_1',
  title: 'Governed deployment decision',
  content: 'MemoryV4 remains authoritative for durable knowledge.\nNo direct browser writes.',
  role: 'canonical',
  lifecycle: 'live',
  write_policy: 'immutable',
  scope_path: 'org:a/project:unify',
  entity: { entity_type: 'project', id: 'unify' },
  topic: 'architecture',
  tags: ['unify', 'memory'],
  confidence: 0.98,
  source_refs: ['repo:/srv/unify/docs/adapters/MEMORY-V4.md'],
  provenance: { source: 'operator-review' },
  attrs: {},
  author_actor: 'unify:user-1',
  version: 3,
  supersedes: null,
  superseded_by: null,
  created_at: '2026-08-08T10:00:00Z',
  updated_at: '2026-08-08T12:00:00Z',
};
const entity: MemoryEntity = {
  id: 'unify',
  entity_type: 'project',
  name: 'UNIFY',
  scope_path: 'org:a/project:unify',
  attrs: { owner: 'platform' },
  version: 2,
  created_at: '2026-08-08T10:00:00Z',
  updated_at: '2026-08-08T12:00:00Z',
};

function implementation(path: string) {
  if (path === '/memory/status') return { status: 'ready', contractVersion: '1.0.0' };
  if (path === '/memory/capabilities')
    return {
      service: 'memoryv4-core',
      contract_version: '1.0.0',
      api_style: 'unversioned-v1',
      architecture: { store: 'SQLite' },
      operations: [
        {
          method: 'GET',
          path: '/records',
          permission: 'memory.read',
          status: 'implemented',
          mutation: false,
        },
      ],
    };
  if (path.startsWith('/memory/records?limit=100')) return { records: [record], next_cursor: null };
  if (path.startsWith('/memory/entities?limit=100'))
    return { entities: [entity], next_cursor: null };
  if (path.startsWith('/memory/relations?limit=100'))
    return {
      relations: [
        {
          id: 'rel_1',
          from: { kind: 'entity', entity_type: 'project', id: 'unify' },
          to: { kind: 'record', id: 'rec_1' },
          relation_type: 'contains',
          scope_path: 'org:a/project:unify',
          author_actor: 'unify:user-1',
          version: 1,
          created_at: '2026-08-08T10:00:00Z',
          updated_at: '2026-08-08T10:00:00Z',
        },
      ],
      next_cursor: null,
    };
  if (path.startsWith('/memory/artifacts?limit=100'))
    return {
      artifacts: [
        {
          id: 'art_1',
          record_id: 'rec_1',
          entity: null,
          artifact_type: 'repository',
          uri: 'repo:/srv/unify',
          checksum: null,
          scope_path: 'org:a/project:unify',
          author_actor: 'unify:user-1',
          version: 1,
          created_at: '2026-08-08T10:00:00Z',
          updated_at: '2026-08-08T10:00:00Z',
        },
      ],
      next_cursor: null,
    };
  if (path.startsWith('/memory/search?'))
    return { results: [{ record, score: 9.5 }], next_cursor: null };
  if (path === '/memory/context/project/unify')
    return { entity, records: [record], relations: [], artifacts: [], truncated: false };
  if (path === '/memory/audit/events?limit=100')
    return {
      events: [
        {
          id: 1,
          action: 'record.create',
          object_type: 'record',
          object_id: 'rec_1',
          actor: 'unify:user-1',
          scope_path: 'org:a/project:unify',
          detail: {},
          created_at: '2026-08-08T10:00:00Z',
        },
      ],
      next_cursor: null,
    };
  if (path === '/memory/retrieval-events?limit=100')
    return {
      events: [
        {
          id: 2,
          query: 'deployment',
          scope_path: 'org:a/project:unify',
          actor: 'unify:user-1',
          result_count: 1,
          degraded: false,
          created_at: '2026-08-08T11:00:00Z',
        },
      ],
      next_cursor: null,
    };
  throw new Error(`Unexpected MemoryV4 path: ${path}`);
}

beforeEach(() => {
  mockedApi.mockImplementation(async (path) => implementation(path) as never);
  mockedMemoryMutation.mockResolvedValue({ ...record, version: 4 } as never);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderView(
  canReadAudit = true,
  permissions: { canWrite?: boolean; canPromote?: boolean; canAdmin?: boolean } = {},
) {
  return render(
    <MantineProvider>
      <MemoryView
        canReadAudit={canReadAudit}
        canWrite={permissions.canWrite ?? false}
        canPromote={permissions.canPromote ?? false}
        canAdmin={permissions.canAdmin ?? false}
      />
    </MantineProvider>,
  );
}

describe('MemoryView', () => {
  it('renders connected read-only source status, visible counts and a governed record reader', async () => {
    const { container } = renderView();
    expect(await screen.findByRole('heading', { name: 'Memory & knowledge' })).toBeInTheDocument();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(screen.getByText(/contract 1.0.0/)).toBeInTheDocument();
    expect(screen.getByText('Governed deployment decision')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Governed deployment decision/ }));
    expect(
      screen.getByRole('heading', { name: 'Governed deployment decision' }),
    ).toBeInTheDocument();
    expect(screen.getByText('immutable')).toBeInTheDocument();
    expect(screen.getByText('repo:/srv/unify/docs/adapters/MEMORY-V4.md')).toBeInTheDocument();
    expect(screen.getAllByText(/No direct browser writes/)).toHaveLength(2);
    expect(mockedApi.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
      true,
    );

    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('searches authoritative records with governance filters and opens the result reader', async () => {
    renderView();
    await screen.findByText('Connected');
    await userEvent.click(screen.getByText('Search', { selector: 'span' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Search governed records' }),
      'deployment plan',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search MemoryV4' }));
    expect(await screen.findByText(/Score 9.5000/)).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith(
      expect.stringMatching(/^\/memory\/search\?q=deployment\+plan/),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Read record' }));
    expect(screen.getByText('Record reader')).toBeInTheDocument();
  });

  it('loads governed entity context and exposes connected objects without write controls', async () => {
    renderView();
    await screen.findByText('Connected');
    await userEvent.click(screen.getByText('Entities', { selector: 'span' }));
    await userEvent.click(screen.getByRole('button', { name: 'View context' }));
    expect(await screen.findByText(/1 records · 0 relations · 0 artifacts/)).toBeInTheDocument();
    expect(mockedApi).toHaveBeenCalledWith('/memory/context/project/unify');
    expect(
      screen.queryByRole('button', { name: /edit|delete|promote|archive/i }),
    ).not.toBeInTheDocument();
  });

  it('applies a descendant scope to all authoritative collection reads', async () => {
    renderView();
    await screen.findByText('Connected');
    mockedApi.mockClear();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Memory scope' }),
      'org:a/project:unify',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Apply scope' }));
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/memory/records?limit=100&scope_path=org%3Aa%2Fproject%3Aunify',
      ),
    );
    for (const collection of ['entities', 'relations', 'artifacts']) {
      expect(mockedApi).toHaveBeenCalledWith(
        `/memory/${collection}?limit=100&scope_path=org%3Aa%2Fproject%3Aunify`,
      );
    }
    expect(screen.getByText('org:a/project:unify')).toBeInTheDocument();
  });

  it('gates source evidence by UNIFY audit permission', async () => {
    const { rerender } = renderView(false);
    await screen.findByText('Connected');
    expect(screen.queryByText('Evidence', { selector: 'span' })).not.toBeInTheDocument();
    rerender(
      <MantineProvider>
        <MemoryView canReadAudit canWrite={false} canPromote={false} canAdmin={false} />
      </MantineProvider>,
    );
    await userEvent.click(screen.getByText('Evidence', { selector: 'span' }));
    expect(await screen.findByText('record.create')).toBeInTheDocument();
    expect(screen.getByText('deployment')).toBeInTheDocument();
  });

  it('keeps initial loading distinct from an authoritative empty result', () => {
    mockedApi.mockImplementation(() => new Promise(() => undefined));
    renderView();
    expect(screen.getByLabelText('Loading MemoryV4 knowledge')).toBeInTheDocument();
    expect(screen.getByText('Checking')).toBeInTheDocument();
    expect(screen.queryByText('No records visible')).not.toBeInTheDocument();
  });

  it('labels successful empty collection pages as authoritative', async () => {
    mockedApi.mockImplementation(async (path) => {
      if (path.startsWith('/memory/records?')) return { records: [], next_cursor: null } as never;
      if (path.startsWith('/memory/entities?')) return { entities: [], next_cursor: null } as never;
      if (path.startsWith('/memory/relations?'))
        return { relations: [], next_cursor: null } as never;
      if (path.startsWith('/memory/artifacts?'))
        return { artifacts: [], next_cursor: null } as never;
      return implementation(path) as never;
    });
    renderView();
    expect(await screen.findByText('No records visible')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Entities', { selector: 'span' }));
    expect(screen.getByText('No entities visible')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Relations & artifacts', { selector: 'span' }));
    expect(screen.getByText('No relations visible')).toBeInTheDocument();
    expect(screen.getByText('No artifacts visible')).toBeInTheDocument();
  });

  it('reports adapter failure truthfully instead of rendering an empty source', async () => {
    mockedApi.mockRejectedValue(new Error('MemoryV4 adapter is not configured'));
    renderView();
    const failure = await screen.findByRole('alert', { name: 'MemoryV4 data unavailable' });
    expect(failure).toHaveTextContent('MemoryV4 adapter is not configured');
    expect(failure).toHaveTextContent('No empty result is inferred');
    expect(screen.queryByText('No records visible')).not.toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
  });

  it('edits the selected record with an exact version precondition and explicit confirmation', async () => {
    renderView(true, { canWrite: true });
    await screen.findByText('Connected');
    await userEvent.click(screen.getByRole('button', { name: /Governed deployment decision/ }));
    await userEvent.click(screen.getByText('Governed editing', { selector: 'span' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Governed action' }));
    await userEvent.click(screen.getByText('Edit selected record', { selector: 'span' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(screen.getByRole('textbox', { name: 'Content' })).toHaveAttribute(
      'maxlength',
      '1000000',
    );
    await userEvent.clear(title);
    await userEvent.type(title, 'Reviewed deployment decision');
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: /reviewed the target, scope and authoritative effect/i,
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save record edit' }));
    await waitFor(() =>
      expect(mockedMemoryMutation).toHaveBeenCalledWith(
        '/memory/records/rec_1',
        'PATCH',
        expect.objectContaining({
          version: 3,
          body: expect.objectContaining({ title: 'Reviewed deployment decision' }),
        }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('version 4');
  });

  it('rejects oversized source-reference input before a governed mutation', async () => {
    renderView(true, { canWrite: true });
    await screen.findByText('Connected');
    await userEvent.click(screen.getByRole('button', { name: /Governed deployment decision/ }));
    await userEvent.click(screen.getByText('Governed editing', { selector: 'span' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Governed action' }));
    await userEvent.click(screen.getByText('Edit selected record', { selector: 'span' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Source references' }), {
      target: { value: Array.from({ length: 101 }, (_, index) => `ref:${index}`).join('\n') },
    });
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: /reviewed the target, scope and authoritative effect/i,
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save record edit' }));
    expect(
      await screen.findByRole('alert', { name: 'Governed action rejected' }),
    ).toHaveTextContent('limited to 100 lines');
    expect(mockedMemoryMutation).not.toHaveBeenCalled();
  });

  it('gates promotion independently and requires a durable reason', async () => {
    renderView(false, { canPromote: true });
    await screen.findByText('Connected');
    await userEvent.click(screen.getByRole('button', { name: /Governed deployment decision/ }));
    await userEvent.click(screen.getByText('Governed editing', { selector: 'span' }));
    expect(screen.getByRole('combobox', { name: 'Governed action' })).toHaveValue(
      'Promote selected record',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Governance reason' }),
      'Reviewed and accepted as canonical',
    );
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: /reviewed the target, scope and authoritative effect/i,
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Promote record' }));
    await waitFor(() =>
      expect(mockedMemoryMutation).toHaveBeenCalledWith('/memory/records/rec_1/promote', 'POST', {
        version: 3,
        reason: 'Reviewed and accepted as canonical',
      }),
    );
  });

  it('reports version conflicts without silently overwriting authoritative memory', async () => {
    mockedMemoryMutation.mockRejectedValue(
      new ApiError(412, { code: 'version_conflict', message: 'record version does not match' }),
    );
    renderView(true, { canWrite: true });
    await screen.findByText('Connected');
    await userEvent.click(screen.getByRole('button', { name: /Governed deployment decision/ }));
    await userEvent.click(screen.getByText('Governed editing', { selector: 'span' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Governed action' }));
    await userEvent.click(screen.getByText('Edit selected record', { selector: 'span' }));
    await userEvent.click(
      screen.getByRole('checkbox', {
        name: /reviewed the target, scope and authoritative effect/i,
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save record edit' }));
    expect(
      await screen.findByRole('alert', { name: 'Governed action rejected' }),
    ).toHaveTextContent('changed after it was loaded');
  });
});
