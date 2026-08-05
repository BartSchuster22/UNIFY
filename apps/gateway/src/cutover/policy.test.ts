import { describe, expect, it } from 'vitest';
import { CutoverPolicy } from './policy.js';
import type { MutationInput } from '../mutations/types.js';

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
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
    );
  });

  it('requires written acceptance for every enabled domain', () => {
    expect(() =>
      CutoverPolicy.fromEnv({ DEPLOYMENT_MODE: 'mutation-canary', MUTATION_DOMAINS: 'chat' }),
    ).toThrowError(/written acceptance/);
  });

  it('contains accepted legacy Chat writes while exposing only the Hermes-native chat domain', () => {
    const active = CutoverPolicy.fromEnv({
      DEPLOYMENT_MODE: 'mutation-canary',
      MUTATION_DOMAINS: 'chat',
      MUTATION_ACCEPTANCE_REFS: 'chat=acceptance/CHAT-001',
    });
    expect(() => active.assertAllowed(mutation('chat', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
    );
    expect(active.status()).toMatchObject({ legacyWritesContained: true });
    expect(active.status().domains.find((domain) => domain.domain === 'chat')).toMatchObject({
      executeEnabled: true,
      acceptanceRef: 'acceptance/CHAT-001',
    });
    expect(() => active.assertAllowed(mutation('memory-v4', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
    );
    const rolledBack = CutoverPolicy.fromEnv({ DEPLOYMENT_MODE: 'mutation-canary' });
    expect(rolledBack.status().domains.every((domain) => !domain.executeEnabled)).toBe(true);
    expect(() => rolledBack.assertAllowed(mutation('chat', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
    );
  });

  it('enables only accepted Hermes-owned Work execution', () => {
    const active = CutoverPolicy.fromEnv({
      DEPLOYMENT_MODE: 'mutation-canary',
      MUTATION_DOMAINS: 'work',
      MUTATION_ACCEPTANCE_REFS: 'work=phase6/hermes-work',
    });
    const work: MutationInput = {
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
    };
    expect(() => active.assertAllowed(work)).not.toThrow();
    expect(active.status().domains.find((domain) => domain.domain === 'work')).toMatchObject({
      executeEnabled: true,
      acceptanceRef: 'phase6/hermes-work',
    });
    expect(() => active.assertAllowed(mutation('memory-v4', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
    );
  });

  it('enables accepted Hermes-owned internal conversation execution while containing legacy Chat', () => {
    const active = CutoverPolicy.fromEnv({
      DEPLOYMENT_MODE: 'mutation-canary',
      MUTATION_DOMAINS: 'chat',
      MUTATION_ACCEPTANCE_REFS: 'chat=task8/hermes-internal-conversations',
    });
    const conversation: MutationInput = {
      operationType: 'chat.message.send',
      target: {
        owner: 'hermes',
        kind: 'session',
        nativeId: 'internal-session',
        frameworkId: 'hermes-main',
      },
      payload: { message: 'Verify' },
      mode: 'execute',
      confirmed: false,
    };
    expect(() => active.assertAllowed(conversation)).not.toThrow();
    expect(active.status().domains.find((domain) => domain.domain === 'chat')).toMatchObject({
      executeEnabled: true,
      acceptanceRef: 'task8/hermes-internal-conversations',
    });
    expect(() => active.assertAllowed(mutation('chat', 'execute'))).toThrowError(
      expect.objectContaining({ code: 'LEGACY_WRITE_CONTAINED' }),
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
