import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
  HermesCapabilitiesResponseSchema,
  HermesControlCommandSchema,
  HermesControlErrorResponseSchema,
  HermesEventEnvelopeSchema,
  HermesHealthResponseSchema,
  HermesIdentityResponseSchema,
  HermesProfileCommandSchema,
  HermesProviderSchema,
  HermesVersionResponseSchema,
  GatewayHermesAgentsSchema,
} from './index.js';

const meta = {
  contractVersion: HERMES_CONTROL_VERSION,
  frameworkId: 'hermes-dev',
  frameworkVersion: PINNED_HERMES_RELEASE,
  frameworkCommit: PINNED_HERMES_COMMIT,
  sourceVersion: `git:${PINNED_HERMES_COMMIT}`,
  observedAt: '2026-07-21T12:00:00.000Z',
};

describe('hermes-control/v1 frozen contracts', () => {
  it('accepts the pinned identity, health, version, and capability envelopes', () => {
    expect(
      Value.Check(HermesIdentityResponseSchema, {
        ...meta,
        data: { runtime: 'hermes-agent', instanceId: 'pinned', displayName: 'Hermes' },
      }),
    ).toBe(true);
    expect(
      Value.Check(HermesHealthResponseSchema, {
        ...meta,
        data: { status: 'healthy', checks: { runtime: { status: 'healthy' } } },
      }),
    ).toBe(true);
    expect(
      Value.Check(HermesVersionResponseSchema, {
        ...meta,
        data: {
          release: PINNED_HERMES_RELEASE,
          commit: PINNED_HERMES_COMMIT,
          dirty: false,
          pythonVersion: '3.11.15',
        },
      }),
    ).toBe(true);
    expect(
      Value.Check(HermesCapabilitiesResponseSchema, {
        ...meta,
        data: {
          capabilities: {
            'profiles.read': {
              status: 'unsupported',
              modes: [],
              requiredScopes: ['control:read'],
              reasonCode: 'PHASE_2_NOT_IMPLEMENTED',
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('distinguishes unsupported, unavailable, and forbidden capabilities', () => {
    for (const status of ['unsupported', 'unavailable', 'forbidden']) {
      expect(
        Value.Check(HermesCapabilitiesResponseSchema, {
          ...meta,
          data: { capabilities: { test: { status, modes: [], requiredScopes: ['control:read'] } } },
        }),
      ).toBe(true);
    }
  });

  it('requires source versions, idempotency metadata, and replayable event identity', () => {
    expect(
      Value.Check(HermesControlCommandSchema, {
        mode: 'execute',
        idempotencyKey: 'key-1',
        expectedSourceVersion: '7',
        requestId: 'req-1',
        correlationId: 'corr-1',
        actor: { type: 'service', id: 'unify' },
        payload: {},
      }),
    ).toBe(true);
    const eventMeta = {
      contractVersion: meta.contractVersion,
      frameworkId: meta.frameworkId,
      frameworkVersion: meta.frameworkVersion,
      frameworkCommit: meta.frameworkCommit,
      sourceVersion: meta.sourceVersion,
    };
    expect(
      Value.Check(HermesEventEnvelopeSchema, {
        ...eventMeta,
        eventId: 'evt-1',
        sequence: 1,
        type: 'profile.updated',
        classification: 'durable',
        occurredAt: meta.observedAt,
        payload: {},
      }),
    ).toBe(true);
  });

  it('accepts governed native profile rename commands with source-version preconditions', () => {
    expect(
      Value.Check(HermesProfileCommandSchema, {
        mode: 'execute',
        idempotencyKey: 'rename-default-alica',
        expectedSourceVersion: 'sha256:profiles-v1',
        requestId: 'req-rename',
        correlationId: 'corr-rename',
        actor: { type: 'user', id: 'operator-1' },
        payload: { newId: 'alica' },
        operation: 'profile.rename',
        targetId: 'default',
      }),
    ).toBe(true);
  });

  it('defines governed Agents as framework-scoped native profile projections', () => {
    expect(
      Value.Check(GatewayHermesAgentsSchema, {
        meta: {
          owner: 'hermes',
          frameworkId: 'hermes-alica',
          frameworkVersion: PINNED_HERMES_RELEASE,
          frameworkCommit: PINNED_HERMES_COMMIT,
          sourceVersion: 'sha256:profiles-v2',
          freshness: 'current',
          observedAt: meta.observedAt,
        },
        items: [
          {
            id: 'research-agent',
            displayName: 'Research Agent',
            active: false,
            gatewayStatus: 'stopped',
            owner: 'hermes',
            frameworkId: 'hermes-alica',
            sourceVersion: 'sha256:profiles-v2',
            observedAt: meta.observedAt,
            kind: 'agent',
            agentId: 'hermes-alica:research-agent',
            nativeProfileId: 'research-agent',
          },
        ],
        page: { hasMore: false },
      }),
    ).toBe(true);
  });

  it('accepts truthful provider setup and readiness contracts without secret values', () => {
    expect(
      Value.Check(HermesProviderSchema, {
        id: 'vertex',
        displayName: 'Google Vertex AI',
        credentialStatus: 'missing',
        selected: false,
        authType: 'unknown',
        authMethod: 'cloud_identity',
        credentialMutable: false,
        setupSupported: false,
        setupFields: [
          {
            id: 'project',
            label: 'Google Cloud project',
            type: 'project',
            required: true,
            secret: false,
          },
          {
            id: 'credentials',
            label: 'Service-account credentials',
            type: 'secret_file',
            required: false,
            secret: true,
          },
        ],
        prerequisites: [
          { id: 'google-adc', label: 'Google identity', kind: 'cloud_identity', status: 'unknown' },
        ],
        connectionState: 'disconnected',
        deploymentReadiness: 'needs_configuration',
        readinessReasonCodes: ['PROVIDER_NOT_CONNECTED'],
        modelCount: 0,
      }),
    ).toBe(true);
  });

  it('freezes structured fail-closed errors', () => {
    expect(
      Value.Check(HermesControlErrorResponseSchema, {
        contractVersion: HERMES_CONTROL_VERSION,
        frameworkId: 'hermes-dev',
        error: {
          code: 'unsupported_framework_version',
          message: 'unsupported',
          requestId: 'req-1',
          retryable: false,
        },
      }),
    ).toBe(true);
  });
});
