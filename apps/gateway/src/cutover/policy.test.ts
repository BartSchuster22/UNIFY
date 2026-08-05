import { describe, expect, it } from 'vitest';
import { CutoverPolicy } from './policy.js';
import type { MutationInput } from '../mutations/types.js';

const memoryMutation = (mode: MutationInput['mode']): MutationInput => ({
  operationType: 'memory.record.write',
  target: { owner: 'memory-v4', kind: 'record', nativeId: 'fixture' },
  payload: {},
  mode,
  confirmed: false,
});

const workMutation = (): MutationInput => ({
  operationType: 'work.task.create',
  target: {
    owner: 'hermes',
    kind: 'task',
    nativeId: 'fixture',
    frameworkId: 'hermes-main',
  },
  payload: { boardId: 'alpha', title: 'Verify' },
  mode: 'execute',
  confirmed: false,
});

describe('CutoverPolicy', () => {
  it('defaults to fail-closed read-only while allowing non-executing validation', () => {
    const policy = CutoverPolicy.fromEnv({});
    expect(policy.status().mode).toBe('read-only');
    expect(() => policy.assertAllowed(memoryMutation('validate'))).not.toThrow();
    expect(() => policy.assertAllowed(memoryMutation('execute'))).toThrowError(
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
    );
  });

  it('requires written acceptance for every enabled domain', () => {
    expect(() =>
      CutoverPolicy.fromEnv({ DEPLOYMENT_MODE: 'mutation-canary', MUTATION_DOMAINS: 'work' }),
    ).toThrowError(/written acceptance/);
  });

  it('enables only accepted Hermes-owned Work execution', () => {
    const active = CutoverPolicy.fromEnv({
      DEPLOYMENT_MODE: 'mutation-canary',
      MUTATION_DOMAINS: 'work',
      MUTATION_ACCEPTANCE_REFS: 'work=phase6/hermes-work',
    });
    expect(() => active.assertAllowed(workMutation())).not.toThrow();
    expect(active.status().domains.find((domain) => domain.domain === 'work')).toMatchObject({
      executeEnabled: true,
      acceptanceRef: 'phase6/hermes-work',
    });
    expect(() => active.assertAllowed(memoryMutation('execute'))).toThrowError(
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
    );
  });

  it('does not expose the retired Chat domain', () => {
    expect(() =>
      CutoverPolicy.fromEnv({
        DEPLOYMENT_MODE: 'mutation-canary',
        MUTATION_DOMAINS: 'chat',
        MUTATION_ACCEPTANCE_REFS: 'chat=retired',
      }),
    ).toThrowError(/Unknown mutation domain/);
    expect(
      CutoverPolicy.fromEnv({})
        .status()
        .domains.map((domain) => String(domain.domain)),
    ).not.toContain('chat');
  });

  it('rejects ambiguous or unknown deployment configuration', () => {
    expect(() => CutoverPolicy.fromEnv({ DEPLOYMENT_MODE: 'production' })).toThrowError(
      /DEPLOYMENT_MODE/,
    );
    expect(() =>
      CutoverPolicy.fromEnv({
        DEPLOYMENT_MODE: 'mutation-canary',
        MUTATION_DOMAINS: 'everything',
      }),
    ).toThrowError(/Unknown mutation domain/);
  });
});
