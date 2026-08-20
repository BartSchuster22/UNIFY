-- ALICA Hermes Phase 10: immutable operational drill policy and digest-only evidence.
-- No runtime reader, writer, scheduler, owner dispatch or credential material is added.

CREATE TABLE core.framework_operational_drill_policies (
  policy_id text PRIMARY KEY CHECK (core.is_canonical_id(policy_id, 'drl')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  contract_version text NOT NULL CHECK (contract_version = 'alica-hermes-operational-drills/v0.1'),
  origin_migration integer NOT NULL CHECK (origin_migration = 21),
  target_migration integer NOT NULL CHECK (target_migration = 22),
  rollback_class text NOT NULL CHECK (rollback_class IN ('application-rollback-forward-schema','forward-recovery-only','full-restore')),
  allowed_drills text[] NOT NULL CHECK (
    allowed_drills <@ ARRAY[
      'release-compatibility','restore-identity','move-identity','clone-identity',
      'event-projection-rebuild','credential-revocation','retirement'
    ]::text[]
    AND cardinality(allowed_drills) = 7
  ),
  approval_reference text NOT NULL CHECK (length(approval_reference) BETWEEN 1 AND 500),
  enabled boolean NOT NULL DEFAULT false CHECK (NOT enabled),
  terminal_state text NOT NULL DEFAULT 'disabled' CHECK (terminal_state = 'disabled'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER framework_operational_drill_policies_immutable
BEFORE UPDATE OR DELETE ON core.framework_operational_drill_policies
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_operational_drill_evidence (
  evidence_id text PRIMARY KEY CHECK (core.is_canonical_id(evidence_id, 'evd')),
  policy_id text NOT NULL REFERENCES core.framework_operational_drill_policies(policy_id) ON DELETE RESTRICT,
  drill_kind text NOT NULL CHECK (drill_kind IN (
    'release-compatibility','restore-identity','move-identity','clone-identity',
    'event-projection-rebuild','credential-revocation','retirement'
  )),
  result text NOT NULL CHECK (result IN ('passed','held')),
  execution_scope text NOT NULL CHECK (execution_scope IN ('live-read-only','isolated-restore','isolated-adapter')),
  identity_semantics text NOT NULL CHECK (identity_semantics IN ('not-applicable','preserved','new-identity')),
  origin_framework_id text REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  result_framework_reference text,
  origin_runtime_identity_digest bytea CHECK (origin_runtime_identity_digest IS NULL OR octet_length(origin_runtime_identity_digest) = 32),
  result_runtime_identity_digest bytea CHECK (result_runtime_identity_digest IS NULL OR octet_length(result_runtime_identity_digest) = 32),
  source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32),
  result_digest bytea NOT NULL CHECK (octet_length(result_digest) = 32),
  owner_mutation_count integer NOT NULL CHECK (owner_mutation_count = 0),
  secret_material_persisted boolean NOT NULL CHECK (NOT secret_material_persisted),
  owner_state_preserved boolean NOT NULL CHECK (owner_state_preserved),
  safe_result_code text NOT NULL CHECK (safe_result_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 1000),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (policy_id, drill_kind),
  CHECK ((drill_kind IN ('restore-identity','move-identity') AND identity_semantics = 'preserved')
      OR (drill_kind = 'clone-identity' AND identity_semantics = 'new-identity')
      OR (drill_kind NOT IN ('restore-identity','move-identity','clone-identity') AND identity_semantics = 'not-applicable'))
);
CREATE TRIGGER framework_operational_drill_evidence_immutable
BEFORE UPDATE OR DELETE ON core.framework_operational_drill_evidence
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

REVOKE INSERT, UPDATE, DELETE ON core.framework_operational_drill_policies FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON core.framework_operational_drill_evidence FROM PUBLIC;
