import { createHash } from 'node:crypto';
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
const gatewayHermesMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/004_gateway_hermes_framework.up.sql'),
  'utf8',
);
const hermesWorkMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/005_hermes_work_cutover.up.sql'),
  'utf8',
);
const adapterIsolationMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/008_framework_adapter_isolation.up.sql'),
  'utf8',
);
const modelEventsMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/009_hermes_model_events.up.sql'),
  'utf8',
);
const updateVisibilityMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/010_framework_update_visibility.up.sql'),
  'utf8',
);
const candidateAssessmentMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/011_framework_candidate_assessments.up.sql'),
  'utf8',
);
const hermesBaselineMigration = readFileSync(
  resolve(import.meta.dirname, '../migrations/006_hermes_020_baseline.up.sql'),
);
const migrationRunner = readFileSync(
  resolve(import.meta.dirname, '../scripts/migrate.mjs'),
  'utf8',
);

describe('migration checksum governance', () => {
  it('accepts only the one deployed baseline variant against the pinned current baseline', () => {
    const current = createHash('sha256').update(hermesBaselineMigration).digest('hex');
    expect(current).toBe('b4519c95a8d07b63fc7d19ab2c4f2c89d28ecb0dbdf28b59d360dd881c62bb33');
    expect(migrationRunner).toContain(current);
    expect(migrationRunner).toContain(
      '6cd122ab7c73b1791b3e3c9c769fd06853aa9005835500c691f76950003e4c08',
    );
    expect(migrationRunner).toContain('appliedChecksum !== checksum && !compatible');
  });
});

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

describe('Hermes adapter database isolation migration', () => {
  it('enforces per-framework RLS for every adapter persistence table', () => {
    for (const table of [
      'hermes_adapter_events',
      'hermes_adapter_idempotency',
      'hermes_adapter_audit',
    ]) {
      expect(adapterIsolationMigration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(adapterIsolationMigration).toContain(`ON ${table}`);
    }
    expect(adapterIsolationMigration).toContain("WHEN 'unify_alica_adapter' THEN 'hermes-alica'");
    expect(adapterIsolationMigration).toContain("WHEN 'unify_herman_adapter' THEN 'hermes-herman'");
  });

  it('makes adapter audit append-only and revokes broad mutation privileges', () => {
    expect(adapterIsolationMigration).toContain(
      'REVOKE UPDATE, DELETE ON hermes_adapter_events, hermes_adapter_audit',
    );
    expect(adapterIsolationMigration).toContain('CREATE TRIGGER hermes_adapter_audit_immutable');
    expect(adapterIsolationMigration).toContain(
      "RAISE EXCEPTION 'hermes_adapter_audit is append-only'",
    );
  });
});

describe('Hermes model event migration', () => {
  it('allows model events in the derived adapter event stream', () => {
    expect(modelEventsMigration).toContain(
      "'profiles','providers','models','work','conversations'",
    );
  });
});

describe('framework update visibility migration', () => {
  it('stores immutable deployment evidence, trusted releases and commit comparisons', () => {
    expect(updateVisibilityMigration).toContain('CREATE TABLE framework_deployments');
    expect(updateVisibilityMigration).toContain("image_digest ~ '^sha256:[a-f0-9]{64}$'");
    expect(updateVisibilityMigration).toContain('CREATE TABLE framework_update_sources');
    expect(updateVisibilityMigration).toContain('CHECK (trusted)');
    expect(updateVisibilityMigration).toContain('CREATE TABLE framework_update_candidates');
    expect(updateVisibilityMigration).toContain('CREATE TABLE framework_update_comparisons');
  });
});

describe('framework candidate assessment migration', () => {
  it('stores immutable ready or blocked build evidence with digest constraints', () => {
    expect(candidateAssessmentMigration).toContain('CREATE TABLE framework_candidate_assessments');
    expect(candidateAssessmentMigration).toContain("state IN ('ready','blocked')");
    expect(candidateAssessmentMigration).toContain('contract_passed boolean NOT NULL');
    expect(candidateAssessmentMigration).toContain('acceptance_passed boolean NOT NULL');
    expect(candidateAssessmentMigration).toContain(
      'framework candidate assessment evidence is immutable',
    );
  });
});

describe('Gateway Hermes framework migration', () => {
  it('persists only derived framework events and durable replay cursors', () => {
    expect(gatewayHermesMigration).toContain('CREATE TABLE gateway_framework_events');
    expect(gatewayHermesMigration).toContain('PRIMARY KEY (framework_id, source_sequence)');
    expect(gatewayHermesMigration).toContain(
      "replay_state IN ('idle','replaying','current','gap','unavailable')",
    );
    expect(gatewayHermesMigration).not.toMatch(
      /CREATE TABLE (?:profiles|providers|models|credentials)\b/,
    );
  });

  it('adds framework authorization without adding legacy profile/model owners', () => {
    expect(gatewayHermesMigration).toContain("'frameworks.manage'");
    expect(gatewayHermesMigration).not.toContain("'agency.manage'");
    expect(gatewayHermesMigration).not.toContain("'dmm.manage'");
  });
});

describe('Hermes Work cutover migration', () => {
  it('grants one governed Hermes Work permission without creating competing domain tables', () => {
    expect(hermesWorkMigration).toContain("'work.manage'");
    expect(hermesWorkMigration).toContain("r.name='Administrator'");
    expect(hermesWorkMigration).not.toMatch(/CREATE TABLE (?:projects|boards|tasks|cronjobs)\b/);
  });
});
