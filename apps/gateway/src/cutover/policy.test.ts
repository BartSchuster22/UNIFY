import { describe, expect, it } from 'vitest';
import { CutoverPolicy } from './policy.js';
import type { MutationInput } from '../mutations/owner-client.js';

const mutation = (
  owner: MutationInput['target']['owner'],
  mode: MutationInput['mode'],
): MutationInput => ({
  operationType: owner === 'chat' ? 'chat.message.send' : 'worker.project.start',
  target: { owner, kind: owner === 'chat' ? 'chat-session' : 'project', nativeId: 'fixture' },
  payload: {},
  mode,
  confirmed: false,
});

describe('CutoverPolicy', () => {
  it('defaults to fail-closed read-only while allowing non-executing validation', () => {
    const policy = CutoverPolicy.fromEnv({});
    expect(policy.status().mode).toBe('read-only');
    expect(() => policy.assertAllowed(mutation('chat', 'validate'))).not.toThrow();
    expect(() => policy.assertAllowed(mutation('chat', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'DEPLOYMENT_READ_ONLY' }),
    );
  });

  it('requires written acceptance for every enabled domain', () => {
    expect(() =>
      CutoverPolicy.fromEnv({ DEPLOYMENT_MODE: 'mutation-canary', MUTATION_DOMAINS: 'chat' }),
    ).toThrowError(/written acceptance/);
  });

  it('activates only accepted domains and provides deterministic rollback state', () => {
    const active = CutoverPolicy.fromEnv({
      DEPLOYMENT_MODE: 'mutation-canary',
      MUTATION_DOMAINS: 'chat',
      MUTATION_ACCEPTANCE_REFS: 'chat=acceptance/CHAT-001',
    });
    expect(() => active.assertAllowed(mutation('chat', 'execute'))).not.toThrow();
    expect(() => active.assertAllowed(mutation('worker', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'MUTATION_DOMAIN_DISABLED' }),
    );
    const rolledBack = CutoverPolicy.fromEnv({ DEPLOYMENT_MODE: 'mutation-canary' });
    expect(rolledBack.status().domains.every((domain) => !domain.executeEnabled)).toBe(true);
    expect(() => rolledBack.assertAllowed(mutation('chat', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'MUTATION_DOMAIN_DISABLED' }),
    );
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
