import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(import.meta.dirname, '../migrations/001_gateway_foundation.up.sql'),
  'utf8',
);
const registryMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/002_hermes_control_registry.up.sql'),
  'utf8',
);
const adapterMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/003_hermes_adapter_foundations.up.sql'),
  'utf8',
);
describe('gateway foundation migration', () => {
  it.each([
    'users',
    'sessions',
    'roles',
    'permissions',
    'operations',
    'idempotency_records',
    'audit_events',
    'evidence_references',
    'resource_mappings',
  ])('owns required table %s', (table) => {
    expect(migration).toContain(`CREATE TABLE ${table} (`);
  });
  it('does not create downstream inventory tables', () => {
    expect(migration).not.toMatch(/CREATE TABLE (models|messages|memory_records|kanban_cards) \(/);
  });
  it('constrains operation payload hashes and idempotency scope', () => {
    expect(migration).toContain("payload_hash ~ '^[a-f0-9]{64}$'");
    expect(migration).toContain('PRIMARY KEY (actor_id, operation_class, idempotency_key)');
  });
});

describe('Hermes control registry migration', () => {
  it('pins contract, version provenance, scoped auth references, and fail-closed status', () => {
    expect(registryMigration).toContain('contract_version text');
    expect(registryMigration).toContain(
      "adapter_id <> 'hermes-control/v1' OR contract_version = 'hermes-control/v1'",
    );
    expect(registryMigration).toContain('framework_commit text');
    expect(registryMigration).toContain('scopes text[]');
    expect(registryMigration).toContain("secret_reference ~ '^env:");
    expect(registryMigration).toContain(
      "status IN ('verified','disabled','unavailable','unsupported')",
    );
  });
});

describe('UNIFY-owned Hermes adapter foundation migration', () => {
  it('persists replayable derived events without a competing domain ledger', () => {
    expect(adapterMigration).toContain('CREATE TABLE hermes_adapter_events');
    expect(adapterMigration).toContain(
      "family text NOT NULL CHECK (family IN ('profiles','providers','work','conversations'))",
    );
    expect(adapterMigration).toContain('UNIQUE (framework_id, family, source_version)');
    expect(adapterMigration).not.toMatch(
      /CREATE TABLE (?:profiles|providers|boards|tasks|messages)\b/,
    );
  });

  it('scopes idempotency and tamper-evident audit persistence', () => {
    expect(adapterMigration).toContain('CREATE TABLE hermes_adapter_idempotency');
    expect(adapterMigration).toContain('PRIMARY KEY (framework_id, capability, idempotency_key)');
    expect(adapterMigration).toContain("request_hash ~ '^sha256:[a-f0-9]{64}$'");
    expect(adapterMigration).toContain('CREATE TABLE hermes_adapter_audit');
    expect(adapterMigration).toContain('previous_event_hash text');
    expect(adapterMigration).toContain(
      "event_hash text NOT NULL UNIQUE CHECK (event_hash ~ '^[a-f0-9]{64}$')",
    );
  });
});
