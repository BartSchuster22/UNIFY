import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import {
  CapabilityManifestSchema,
  ResourceRefSchema,
  UnifiedResourceSchema,
  buildOpenApiDocument,
} from './index.js';

describe('canonical contracts', () => {
  it('requires framework-scoped profile identity fields', () => {
    const valid = {
      canonicalId: 'urn:aquiero:profile:hermes:fw-1:p-1',
      kind: 'profile',
      owner: 'hermes',
      frameworkId: 'fw-1',
      nativeId: 'p-1',
      observedAt: '2026-07-19T00:00:00Z',
    };
    expect(Value.Check(ResourceRefSchema, valid)).toBe(true);
    expect(Value.Check(ResourceRefSchema, { ...valid, nativeId: '' })).toBe(false);
  });
  it('keeps unsupported distinct from unavailable through capability data', () => {
    const manifest = {
      schemaVersion: '1.0',
      adapterId: 'fixture',
      adapterVersion: '1',
      observedAt: '2026-07-19T00:00:00Z',
      capabilities: { 'profiles.delete': { supported: false, reason: 'unsupported' } },
    };
    expect(Value.Check(CapabilityManifestSchema, manifest)).toBe(true);
  });
  it('cannot label migration-only resources authoritative', () => {
    const resource = {
      resource: {
        canonicalId: 'migration:agency:agent-1',
        kind: 'agent',
        owner: 'agency',
        nativeId: 'agent-1',
        observedAt: '2026-07-19T00:00:00Z',
      },
      truth: 'current',
      authoritative: false,
      sourceRole: 'migration-only',
      adapterId: 'agency-read-v1',
      fetchedAt: '2026-07-19T00:00:00Z',
      title: 'Session 1',
      searchableText: 'Session 1',
      data: {},
    };
    expect(Value.Check(UnifiedResourceSchema, resource)).toBe(true);
    expect(Value.Check(UnifiedResourceSchema, { ...resource, authoritative: true })).toBe(false);
  });
  it('emits OpenAPI 3.1 with auth security schemes', () => {
    const document = buildOpenApiDocument() as {
      openapi: string;
      paths: Record<string, unknown>;
      components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
    };
    expect(document.openapi).toBe('3.1.0');
    expect(document.components.securitySchemes).toHaveProperty('cookieSession');
    expect(document.components.schemas).toHaveProperty('ResourceRef');
    expect(document.components.schemas).toHaveProperty('GatewayHermesProfiles');
    expect(document.components.schemas).toHaveProperty('GatewayHermesProviders');
    expect(document.paths).toHaveProperty('/frameworks/{frameworkId}/capabilities');
    expect(document.paths).toHaveProperty('/frameworks/{frameworkId}/profiles');
    expect(document.paths).toHaveProperty('/frameworks/{frameworkId}/providers');
  });
});
