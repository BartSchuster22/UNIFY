import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gateway } from './api';
import { ProfilesView } from './ProfilesView';

const inventory = {
  frameworks: { frameworks: [{ id: 'hermes-main', name: 'Main Hermes', default: true }] },
  profiles: {
    status: 'current',
    generatedAt: '2026-07-20T12:00:00.000Z',
    profiles: [
      { id: 'default', profileId: 'default', frameworkId: 'hermes-main', displayName: 'Herman', runtimeStatus: 'active', lifecycleStatus: 'active', primaryModel: { modelRef: 'openai-codex/gpt-5.6-sol' } },
      { id: 'chatboard', profileId: 'chatboard', frameworkId: 'hermes-main', displayName: 'Chatboard', runtimeStatus: 'stopped', lifecycleStatus: 'active', primaryModel: { modelRef: 'openai-codex/gpt-5.5' } },
    ],
  },
  agents: { agents: [
    { id: 'herman', displayName: 'Herman', agentClass: 'base', profileRefs: ['hermes:profile:default'] },
    { id: 'chatboard', displayName: 'Chatboard', agentClass: 'independent', profileRefs: ['hermes:profile:chatboard'] },
  ] },
};
const context = {
  capabilities: { capabilities: { capabilityStatus: { edit_identity: true, edit_models: true, runtime_control: true }, contractSatisfied: true, sourceStatus: 'authoritative' } },
  models: { modelInventoryStatus: 'authoritative', models: [
    { modelRef: 'openai-codex/gpt-5.6-sol', displayName: 'GPT 5.6 SOL' },
  ] },
  detail: { profile: { ...inventory.profiles.profiles[0], description: 'Primary orchestrator', identityFilesStatus: 'current', identityFiles: [{ path: 'AGENTS.md', content: '# Herman' }], fallbackModels: [{ modelRef: 'openai-codex/gpt-5.5' }], runtime: { pid: 42 }, health: { state: 'healthy' }, usage: { requests: 7 } }, profileProtection: { protected: true, policy: 'base_agent' } },
};

function renderProfiles() {
  return render(<MantineProvider><ProfilesView canManage canManageModels canDelete /></MantineProvider>);
}

describe('UNIFY Profiles', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/?view=profiles');
    vi.stubGlobal('fetch', vi.fn(async (request: string | URL | Request) => {
      const url = String(request);
      if (url.endsWith('/api/v1/profiles/agency-context')) return Response.json(inventory);
      if (url.includes('/api/v1/profiles/agency-context/hermes-main')) return Response.json(context);
      return Response.json({ error: { code: 'NOT_FOUND', message: 'Not found' } }, { status: 404 });
    }));
    vi.spyOn(gateway, 'mutate').mockResolvedValue({
      replayed: false,
      operation: { operationId: 'op-profile', operationType: 'profile.identity.update', state: 'succeeded', mode: 'dry-run', updatedAt: '2026-07-20T12:00:00.000Z' },
      result: { valid: true, dryRun: true },
    });
  });

  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('shows the requested Agent, Type, Model and Truth inventory and opens Agent detail', async () => {
    renderProfiles();
    expect(await screen.findByRole('columnheader', { name: 'Agent' })).toBeInTheDocument();
    for (const heading of ['Type', 'Model', 'Truth']) expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    expect(screen.getByText('base')).toBeInTheDocument();
    expect(screen.getByText('independent')).toBeInTheDocument();
    expect(screen.getByText('openai-codex/gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Herman' }));
    expect(await screen.findByRole('heading', { name: 'Agent details' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Primary orchestrator')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Edit model config' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Runtime controls' })).toBeInTheDocument();
  });

  it('provides Agency-equivalent create fields and dry-runs the exact governed payload', async () => {
    window.history.replaceState(null, '', '/?view=profiles&profilePage=create');
    renderProfiles();
    expect(await screen.findByRole('heading', { name: 'Create new Agent' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: /Display name/ }), { target: { value: 'Release Agent' } });
    await screen.findByText(/1 models\./);
    await waitFor(() => expect((screen.getByRole('combobox', { name: /Primary model/ }) as HTMLInputElement).value).toContain('GPT 5.6 SOL'));
    fireEvent.click(screen.getByRole('button', { name: 'Run create dry-run' }));
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'profile.create',
      target: expect.objectContaining({ frameworkId: 'hermes-main', nativeId: 'release-agent' }),
      mode: 'dry-run',
      payload: expect.objectContaining({ displayName: 'Release Agent', identityFiles: expect.any(Array), modelConfig: { primary: 'openai-codex/gpt-5.6-sol', fallbacks: [] } }),
    })));
    expect(await screen.findByText('Exact payload validated')).toBeInTheDocument();
  });

  it('edits identity through an Agency dry-run before enabling apply', async () => {
    window.history.replaceState(null, '', '/?view=profiles&profilePage=detail&framework=hermes-main&agent=default');
    renderProfiles();
    const identity = await screen.findByRole('textbox', { name: 'Identity content 1' });
    fireEvent.change(identity, { target: { value: '# Herman\n\nUpdated behavior' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Run dry-run' })[0]!);
    await waitFor(() => expect(gateway.mutate).toHaveBeenCalledWith(expect.objectContaining({
      operationType: 'profile.identity.update',
      mode: 'dry-run',
      payload: { identityFiles: [{ path: 'AGENTS.md', content: '# Herman\n\nUpdated behavior' }] },
    })));
    expect(await screen.findByText('Exact payload passed Agency dry-run.')).toBeInTheDocument();
  });
});
