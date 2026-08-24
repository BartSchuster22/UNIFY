import { describe, expect, it, vi } from 'vitest';
import { AgentManagementService } from './service.js';

function fixture() {
  const profiles = vi.fn().mockResolvedValue({
    meta: {
      owner: 'hermes',
      frameworkId: 'hermes-alica',
      sourceVersion: 'sha256:profiles-v2',
      freshness: 'current',
      warnings: [],
    },
    items: [
      {
        id: 'research-agent',
        displayName: 'Research Agent',
        active: false,
        gatewayStatus: 'stopped',
        owner: 'hermes',
        frameworkId: 'hermes-alica',
      },
    ],
    page: { hasMore: false },
  });
  const parse = vi.fn((value) => value);
  const permission = vi.fn(() => 'profiles.manage');
  const run = vi.fn().mockResolvedValue({ operation: { state: 'verified' } });
  const service = new AgentManagementService(
    { profiles } as never,
    { parse, permission, run } as never,
  );
  return { service, profiles, parse, permission, run };
}

describe('governed Agent management', () => {
  it('projects native Hermes profiles without creating a competing Agent owner', async () => {
    const { service, profiles } = fixture();
    const result = await service.list('hermes-alica', { limit: 100 });
    expect(profiles).toHaveBeenCalledWith('hermes-alica', { limit: 100 });
    expect(result).toMatchObject({
      meta: { owner: 'hermes', frameworkId: 'hermes-alica' },
      items: [
        {
          id: 'research-agent',
          owner: 'hermes',
          frameworkId: 'hermes-alica',
          kind: 'agent',
          agentId: 'hermes-alica:research-agent',
          nativeProfileId: 'research-agent',
        },
      ],
    });
  });

  it('maps Agent lifecycle requests to exact framework-scoped profile mutations', async () => {
    const { service, parse, permission, run } = fixture();
    const input = service.mutation('profile.rename', 'hermes-alica', 'research-agent', {
      expectedSourceVersion: 'sha256:profiles-v2',
      newId: 'investigation-agent',
      mode: 'execute',
      confirmed: true,
    });
    expect(parse).toHaveBeenCalledWith({
      operationType: 'profile.rename',
      target: {
        owner: 'hermes',
        kind: 'profile',
        nativeId: 'research-agent',
        frameworkId: 'hermes-alica',
      },
      payload: {
        expectedSourceVersion: 'sha256:profiles-v2',
        newId: 'investigation-agent',
      },
      mode: 'execute',
      confirmed: true,
    });
    expect(service.permission(input as never)).toBe('profiles.manage');
    await service.run('operator-1', 'phase2-agent-rename', input as never);
    expect(permission).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith('operator-1', 'phase2-agent-rename', input);
  });
});
