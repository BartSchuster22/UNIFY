import { describe, expect, it } from 'vitest';
import {
  HERMES_CONTROL_VERSION,
  PINNED_HERMES_COMMIT,
  PINNED_HERMES_RELEASE,
} from '@aquiero/contracts';
import { parseDeclarativeFrameworkRegistrations } from './declarative.js';

const framework = {
  frameworkId: 'hermes-alica',
  displayName: 'Alica',
  baseUrl: 'https://alica:28082',
  serviceAuthReference: 'env:ALICA_FRAMEWORK_TOKEN',
  scopes: ['control:read'] as const,
  expectedContractVersion: HERMES_CONTROL_VERSION,
  expectedFrameworkVersion: PINNED_HERMES_RELEASE,
  expectedFrameworkCommit: PINNED_HERMES_COMMIT,
  enabled: true,
};

describe('declarative framework registrations', () => {
  it('accepts a strict versioned declaration', () => {
    expect(
      parseDeclarativeFrameworkRegistrations({
        schemaVersion: 'unify-framework-registrations/v1',
        frameworks: [framework],
      }).frameworks,
    ).toHaveLength(1);
  });

  it('rejects unknown fields, duplicate identities, and shared auth references', () => {
    expect(() =>
      parseDeclarativeFrameworkRegistrations({
        schemaVersion: 'unify-framework-registrations/v1',
        frameworks: [framework],
        ignored: true,
      }),
    ).toThrow(/Invalid framework registration declaration/u);
    expect(() =>
      parseDeclarativeFrameworkRegistrations({
        schemaVersion: 'unify-framework-registrations/v1',
        frameworks: [framework, framework],
      }),
    ).toThrow(/Duplicate framework ID/u);
    expect(() =>
      parseDeclarativeFrameworkRegistrations({
        schemaVersion: 'unify-framework-registrations/v1',
        frameworks: [framework, { ...framework, frameworkId: 'hermes-herman' }],
      }),
    ).toThrow(/distinct service authentication reference/u);
  });
});
