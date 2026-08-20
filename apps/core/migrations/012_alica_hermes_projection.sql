-- ALICA Hermes projection schema v0.1: additive persistence artifact.
-- Runtime readers/writers and enforcement are intentionally absent.

CREATE OR REPLACE FUNCTION core.generate_alica_id(prefix text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
STRICT
AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw bytea := gen_random_bytes(16);
  epoch_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  encoded text := '';
  group_index integer;
  bit_index integer;
  source_bit integer;
  value integer;
BEGIN
  IF prefix !~ '^[a-z]{2,3}$' THEN
    RAISE EXCEPTION 'invalid ALICA identifier prefix' USING ERRCODE = '22023';
  END IF;
  raw := set_byte(raw, 0, ((epoch_ms >> 40) & 255)::integer);
  raw := set_byte(raw, 1, ((epoch_ms >> 32) & 255)::integer);
  raw := set_byte(raw, 2, ((epoch_ms >> 24) & 255)::integer);
  raw := set_byte(raw, 3, ((epoch_ms >> 16) & 255)::integer);
  raw := set_byte(raw, 4, ((epoch_ms >> 8) & 255)::integer);
  raw := set_byte(raw, 5, (epoch_ms & 255)::integer);
  raw := set_byte(raw, 6, (get_byte(raw, 6) & 15) | 112);
  raw := set_byte(raw, 8, (get_byte(raw, 8) & 63) | 128);
  FOR group_index IN 0..25 LOOP
    value := 0;
    FOR bit_index IN 0..4 LOOP
      source_bit := group_index * 5 + bit_index - 2;
      value := value * 2;
      IF source_bit >= 0 THEN
        value := value + ((get_byte(raw, source_bit / 8) >> (7 - source_bit % 8)) & 1);
      END IF;
    END LOOP;
    encoded := encoded || substr(alphabet, value + 1, 1);
  END LOOP;
  RETURN prefix || '_' || encoded;
END;
$$;

CREATE TABLE core.framework_types (
  framework_type_key text PRIMARY KEY CHECK (framework_type_key ~ '^[a-z][a-z0-9-]+/v[1-9][0-9]*$'),
  owner_key text NOT NULL CHECK (owner_key ~ '^[a-z][a-z0-9-]{1,63}$'),
  adapter_contract text NOT NULL,
  schema_set_digest bytea NOT NULL CHECK (octet_length(schema_set_digest) = 32),
  status text NOT NULL CHECK (status IN ('active','deprecated','retired')),
  decision_reference text NOT NULL CHECK (length(decision_reference) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO core.framework_types
  (framework_type_key, owner_key, adapter_contract, schema_set_digest, status, decision_reference)
VALUES
  ('hermes-agent/v1', 'hermes', 'hermes-control/v1', digest('alica-hermes-projection-schema/v0.1', 'sha256'), 'active', 'ALICA-ADR-0006')
ON CONFLICT DO NOTHING;

CREATE TABLE core.framework_instance_metadata (
  framework_id text PRIMARY KEY REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  framework_type_key text NOT NULL REFERENCES core.framework_types(framework_type_key) ON DELETE RESTRICT,
  runtime_identity_key text NOT NULL CHECK (length(runtime_identity_key) BETWEEN 1 AND 300),
  cell_instance_ref text CHECK (cell_instance_ref IS NULL OR core.is_canonical_id(cell_instance_ref, 'ins')),
  accepted_adapter_contract text NOT NULL,
  accepted_release text NOT NULL,
  accepted_commit text NOT NULL CHECK (accepted_commit ~ '^[a-f0-9]{40}$'),
  desired_lifecycle text NOT NULL CHECK (desired_lifecycle IN ('active','disabled','retired')),
  observed_lifecycle text NOT NULL CHECK (observed_lifecycle IN ('unknown','probing','verified','available','degraded','unavailable','unsupported','disabled','retired')),
  registration_revision bigint NOT NULL DEFAULT 1 CHECK (registration_revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (framework_type_key, runtime_identity_key)
);

CREATE TABLE core.framework_native_aliases (
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  canonical_resource_kind text NOT NULL CHECK (canonical_resource_kind IN ('framework','profile','operation','execution','session')),
  canonical_resource_id text NOT NULL CHECK (
    core.is_any_canonical_id(canonical_resource_id)
    OR core.is_canonical_id(canonical_resource_id, 'op')
  ),
  alias_namespace text NOT NULL CHECK (alias_namespace ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  alias_value text NOT NULL CHECK (length(alias_value) BETWEEN 1 AND 1000),
  alias_kind text NOT NULL CHECK (alias_kind IN ('registration','native-framework','native-instance','predecessor-core','predecessor-gateway','native-resource')),
  source_reference text NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 500),
  first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz,
  PRIMARY KEY (alias_namespace, alias_value),
  UNIQUE (canonical_resource_kind, canonical_resource_id, alias_namespace),
  CHECK (last_observed_at >= first_observed_at),
  CHECK (retired_at IS NULL OR retired_at >= first_observed_at)
);
CREATE TRIGGER framework_native_aliases_immutable
BEFORE UPDATE OR DELETE ON core.framework_native_aliases
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_registrations (
  framework_id text PRIMARY KEY REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  adapter_service_principal_id text NOT NULL CHECK (core.is_canonical_id(adapter_service_principal_id, 'prn')),
  tenant_id text NOT NULL CHECK (core.is_canonical_id(tenant_id, 'ten')),
  client_id text NOT NULL CHECK (core.is_canonical_id(client_id, 'cli')),
  tenant_client_grant_id text NOT NULL CHECK (core.is_canonical_id(tenant_client_grant_id, 'grn')),
  principal_client_grant_id text NOT NULL CHECK (core.is_canonical_id(principal_client_grant_id, 'grn')),
  secret_reference text NOT NULL CHECK (secret_reference ~ '^secret://[A-Za-z0-9._/-]+$'),
  control_origin_reference text NOT NULL CHECK (control_origin_reference ~ '^https://'),
  adapter_scopes text[] NOT NULL CHECK (cardinality(adapter_scopes) BETWEEN 1 AND 32),
  expected_contract text NOT NULL,
  expected_release text NOT NULL,
  expected_commit text NOT NULL CHECK (expected_commit ~ '^[a-f0-9]{40}$'),
  status text NOT NULL CHECK (status IN ('probing','verified','enabled','degraded','disabled','unsupported','retired')),
  verified_at timestamptz,
  fresh_until timestamptz,
  approval_reference text NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status IN ('verified','enabled')) = (verified_at IS NOT NULL)),
  CHECK (fresh_until IS NULL OR verified_at IS NULL OR fresh_until > verified_at)
);

CREATE TABLE core.agent_profile_projections (
  agent_profile_id text PRIMARY KEY CHECK (core.is_canonical_id(agent_profile_id, 'agp')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  native_profile_alias text NOT NULL CHECK (length(native_profile_alias) BETWEEN 1 AND 1000),
  owner text NOT NULL DEFAULT 'hermes' CHECK (owner = 'hermes'),
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 256),
  owner_release text NOT NULL,
  owner_commit text NOT NULL CHECK (owner_commit ~ '^[a-f0-9]{40}$'),
  observed_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  freshness_state text NOT NULL CHECK (freshness_state IN ('current','stale','unavailable','deleted')),
  fresh_until timestamptz,
  payload_schema_key text NOT NULL CHECK (payload_schema_key = 'hermes-profile-safe/v1'),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  projection_generation bigint NOT NULL DEFAULT 1 CHECK (projection_generation > 0),
  local_revision bigint NOT NULL DEFAULT 1 CHECK (local_revision > 0),
  safe_display_name text NOT NULL CHECK (length(safe_display_name) BETWEEN 1 AND 200),
  safe_description text CHECK (safe_description IS NULL OR length(safe_description) <= 5000),
  protected boolean NOT NULL,
  activity_state text NOT NULL CHECK (activity_state IN ('active','inactive','missing','unavailable','deleted')),
  predecessor_profile_id text NOT NULL UNIQUE REFERENCES core.profiles(id) ON DELETE RESTRICT,
  UNIQUE (framework_id, native_profile_alias),
  CHECK (accepted_at >= observed_at),
  CHECK (fresh_until IS NULL OR fresh_until > observed_at)
);

CREATE TABLE core.product_agent_profile_bindings (
  binding_id text PRIMARY KEY CHECK (core.is_canonical_id(binding_id, 'bnd')),
  product_agent_authority text NOT NULL CHECK (length(product_agent_authority) BETWEEN 1 AND 300),
  product_agent_id text NOT NULL CHECK (core.is_canonical_id(product_agent_id, 'agt')),
  tenant_id text NOT NULL CHECK (core.is_canonical_id(tenant_id, 'ten')),
  client_id text NOT NULL CHECK (core.is_canonical_id(client_id, 'cli')),
  tenant_client_grant_id text NOT NULL CHECK (core.is_canonical_id(tenant_client_grant_id, 'grn')),
  delegation_policy_reference text NOT NULL,
  agent_profile_id text NOT NULL REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  capability_ceiling text[] NOT NULL CHECK (cardinality(capability_ceiling) BETWEEN 1 AND 100),
  resource_scope_digest bytea NOT NULL CHECK (octet_length(resource_scope_digest) = 32),
  status text NOT NULL CHECK (status IN ('proposed','active','suspended','revoked','retired')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  approval_reference text NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (product_agent_authority, product_agent_id, tenant_id, client_id, agent_profile_id),
  CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE TABLE core.framework_capability_state (
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  capability_key text NOT NULL CHECK (capability_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  status text NOT NULL CHECK (status IN ('supported','unsupported','unavailable','forbidden')),
  allowed_modes text[] NOT NULL CHECK (allowed_modes <@ ARRAY['read','validate','dry-run','execute']::text[]),
  adapter_scope_ceiling text[] NOT NULL CHECK (cardinality(adapter_scope_ceiling) BETWEEN 1 AND 32),
  safe_reason_code text CHECK (safe_reason_code IS NULL OR safe_reason_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  source_version text NOT NULL,
  owner_release text NOT NULL,
  owner_commit text NOT NULL CHECK (owner_commit ~ '^[a-f0-9]{40}$'),
  observed_at timestamptz NOT NULL,
  fresh_until timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (framework_id, capability_key),
  CHECK (fresh_until > observed_at)
);

CREATE TABLE core.framework_operations (
  operation_id text PRIMARY KEY CHECK (core.is_canonical_id(operation_id, 'op')),
  predecessor_operation_id text NOT NULL UNIQUE REFERENCES core.operations(id) ON DELETE RESTRICT,
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  agent_profile_id text REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  command_id text NOT NULL,
  actor_predecessor_reference text NOT NULL,
  principal_id text CHECK (principal_id IS NULL OR core.is_canonical_id(principal_id, 'prn')),
  tenant_id text CHECK (tenant_id IS NULL OR core.is_canonical_id(tenant_id, 'ten')),
  client_id text CHECK (client_id IS NULL OR core.is_canonical_id(client_id, 'cli')),
  capability_key text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('validate','dry-run','execute')),
  idempotency_key text NOT NULL,
  request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
  authorization_state text NOT NULL CHECK (authorization_state IN ('held','denied','authorized')),
  state text NOT NULL CHECK (state IN ('requested','denied','authorized','dispatched','owner-accepted','completed','failed','inconclusive','reconciled','cancelled')),
  retention_policy_key text NOT NULL,
  requested_at timestamptz NOT NULL,
  terminal_at timestamptz,
  CHECK (authorization_state <> 'authorized' OR (principal_id IS NOT NULL AND tenant_id IS NOT NULL AND client_id IS NOT NULL)),
  CHECK (terminal_at IS NULL OR terminal_at >= requested_at)
);
CREATE TRIGGER framework_operations_immutable
BEFORE UPDATE OR DELETE ON core.framework_operations
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_executions (
  agent_execution_id text PRIMARY KEY CHECK (core.is_canonical_id(agent_execution_id, 'aex')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  agent_profile_id text REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  operation_id text REFERENCES core.framework_operations(operation_id) ON DELETE RESTRICT,
  native_execution_alias text NOT NULL,
  source_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('unknown','queued','running','succeeded','failed','cancelled','inconclusive')),
  observed_at timestamptz NOT NULL,
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  UNIQUE (framework_id, native_execution_alias)
);

CREATE TABLE core.framework_session_projections (
  framework_session_id text PRIMARY KEY CHECK (core.is_canonical_id(framework_session_id, 'fss')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  agent_profile_id text REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  native_session_alias text NOT NULL,
  source_version text NOT NULL,
  state text NOT NULL CHECK (state IN ('current','stale','unavailable','deleted')),
  content_classification text NOT NULL CHECK (content_classification = 'metadata-only'),
  retention_policy_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  UNIQUE (framework_id, native_session_alias)
);

CREATE TABLE core.chat_framework_links (
  product_conversation_authority text NOT NULL,
  product_conversation_id text NOT NULL CHECK (core.is_canonical_id(product_conversation_id, 'con')),
  link_revision bigint NOT NULL CHECK (link_revision > 0),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  agent_profile_id text REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  framework_session_id text REFERENCES core.framework_session_projections(framework_session_id) ON DELETE RESTRICT,
  agent_execution_id text REFERENCES core.framework_executions(agent_execution_id) ON DELETE RESTRICT,
  tenant_id text NOT NULL CHECK (core.is_canonical_id(tenant_id, 'ten')),
  client_id text NOT NULL CHECK (core.is_canonical_id(client_id, 'cli')),
  linkage_state text NOT NULL CHECK (linkage_state IN ('proposed','active','superseded','detached','unresolved')),
  product_source_version text NOT NULL,
  native_source_version text,
  authorization_reference text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at timestamptz,
  PRIMARY KEY (product_conversation_authority, product_conversation_id, link_revision),
  CHECK ((linkage_state = 'superseded') = (superseded_at IS NOT NULL))
);
CREATE UNIQUE INDEX chat_framework_links_one_active
ON core.chat_framework_links (product_conversation_authority, product_conversation_id)
WHERE linkage_state = 'active';

CREATE TABLE core.framework_projection_state (
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  projection_family text NOT NULL CHECK (projection_family IN ('profiles','providers','models','work','cron','sessions','messages','executions')),
  accepted_source_version text,
  payload_digest bytea CHECK (payload_digest IS NULL OR octet_length(payload_digest) = 32),
  accepted_generation bigint NOT NULL DEFAULT 0 CHECK (accepted_generation >= 0),
  item_count integer NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  observed_at timestamptz,
  fresh_until timestamptz,
  status text NOT NULL CHECK (status IN ('current','stale','unavailable','held')),
  rebuild_state text NOT NULL CHECK (rebuild_state IN ('idle','staging','verifying','current','gap','failed','held')),
  retention_policy_key text NOT NULL,
  safe_reason_code text,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (framework_id, projection_family),
  CHECK (fresh_until IS NULL OR observed_at IS NULL OR fresh_until > observed_at)
);

CREATE TABLE core.framework_event_stream_state (
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  stream_key text NOT NULL,
  owner_cursor text,
  last_owner_sequence bigint CHECK (last_owner_sequence IS NULL OR last_owner_sequence >= 0),
  last_event_digest bytea CHECK (last_event_digest IS NULL OR octet_length(last_event_digest) = 32),
  source_version text,
  state text NOT NULL CHECK (state IN ('idle','replaying','current','gap','stalled','reset-detected','unavailable','held')),
  fencing_token text,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  accepted_generation bigint NOT NULL DEFAULT 0 CHECK (accepted_generation >= 0),
  safe_error_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (framework_id, stream_key)
);

CREATE TABLE core.framework_event_receipts (
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  stream_key text NOT NULL,
  owner_event_id text NOT NULL,
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  source_sequence bigint CHECK (source_sequence IS NULL OR source_sequence >= 0),
  source_version text,
  canonical_event_id text REFERENCES core.events(id) ON DELETE RESTRICT,
  classification_schema_key text NOT NULL,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (framework_id, stream_key, owner_event_id),
  UNIQUE (framework_id, stream_key, owner_event_id, payload_digest)
);
CREATE TRIGGER framework_event_receipts_immutable
BEFORE UPDATE OR DELETE ON core.framework_event_receipts
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_compatibility_edges (
  compatibility_edge_id text PRIMARY KEY CHECK (core.is_canonical_id(compatibility_edge_id, 'ced')),
  framework_type_key text NOT NULL REFERENCES core.framework_types(framework_type_key) ON DELETE RESTRICT,
  adapter_contract text NOT NULL,
  origin_release text NOT NULL,
  origin_commit text NOT NULL CHECK (origin_commit ~ '^[a-f0-9]{40}$'),
  target_release text NOT NULL,
  target_commit text NOT NULL CHECK (target_commit ~ '^[a-f0-9]{40}$'),
  cell_profile text NOT NULL,
  schema_set_digest bytea NOT NULL CHECK (octet_length(schema_set_digest) = 32),
  capability_baseline_digest bytea NOT NULL CHECK (octet_length(capability_baseline_digest) = 32),
  rollback_class text NOT NULL CHECK (rollback_class IN ('structural-empty-only','forward-repair','full-restore')),
  evidence_reference text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed','accepted','rejected','withdrawn','revoked')),
  accepted_at timestamptz,
  UNIQUE (framework_type_key, adapter_contract, origin_release, origin_commit, target_release, target_commit, cell_profile, schema_set_digest),
  CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
);

CREATE TABLE core.framework_predecessor_holds (
  hold_id text PRIMARY KEY CHECK (core.is_canonical_id(hold_id, 'hld')),
  predecessor_schema text NOT NULL,
  predecessor_table text NOT NULL,
  predecessor_key text NOT NULL,
  framework_id text REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest) = 32),
  held_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (predecessor_schema, predecessor_table, predecessor_key)
);
CREATE TRIGGER framework_predecessor_holds_immutable
BEFORE UPDATE OR DELETE ON core.framework_predecessor_holds
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_migration_evidence (
  evidence_id text PRIMARY KEY CHECK (core.is_canonical_id(evidence_id, 'evd')),
  migration_contract text NOT NULL CHECK (migration_contract = 'alica-hermes-projection-migration/v0.1'),
  action text NOT NULL CHECK (action IN ('initial-backfill','forward-repair','restore-verification')),
  source_digest bytea NOT NULL CHECK (octet_length(source_digest) = 32),
  result_digest bytea NOT NULL CHECK (octet_length(result_digest) = 32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER framework_migration_evidence_immutable
BEFORE UPDATE OR DELETE ON core.framework_migration_evidence
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

INSERT INTO core.framework_instance_metadata
  (framework_id, framework_type_key, runtime_identity_key, accepted_adapter_contract, accepted_release, accepted_commit, desired_lifecycle, observed_lifecycle)
SELECT framework.id, 'hermes-agent/v1', policy.expected_instance_id, 'hermes-control/v1',
       policy.expected_release, policy.expected_commit,
       CASE framework.desired_state WHEN 'disabled' THEN 'disabled' ELSE 'active' END,
       CASE framework.observed_state WHEN 'available' THEN 'available' WHEN 'degraded' THEN 'degraded'
         WHEN 'unavailable' THEN 'unavailable' WHEN 'disabled' THEN 'disabled' ELSE 'unknown' END
FROM core.frameworks framework
JOIN core.framework_gateway_policies policy ON policy.framework_id = framework.id
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace, alias_value, alias_kind, source_reference)
SELECT framework.id, 'framework', framework.id, 'core.frameworks.id', framework.id, 'predecessor-core', 'core.frameworks'
FROM core.frameworks framework
JOIN core.framework_instance_metadata metadata ON metadata.framework_id = framework.id
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace, alias_value, alias_kind, source_reference)
SELECT policy.framework_id, 'framework', policy.framework_id, 'hermes.native-framework', policy.expected_native_framework_id,
       'native-framework', 'core.framework_gateway_policies.expected_native_framework_id'
FROM core.framework_gateway_policies policy
JOIN core.framework_instance_metadata metadata ON metadata.framework_id = policy.framework_id
ON CONFLICT DO NOTHING;

WITH candidates AS (
  SELECT profile.*, metadata.accepted_release, metadata.accepted_commit,
         core.generate_alica_id('agp') AS canonical_id
  FROM core.profiles profile
  JOIN core.framework_instance_metadata metadata ON metadata.framework_id = profile.framework_id
)
INSERT INTO core.agent_profile_projections
  (agent_profile_id, framework_id, native_profile_alias, source_version, owner_release, owner_commit,
   observed_at, freshness_state, fresh_until, payload_schema_key, payload_digest,
   safe_display_name, safe_description, protected, activity_state, predecessor_profile_id)
SELECT canonical_id, framework_id, native_reference, coalesce(source_version, 'predecessor-unversioned'),
       accepted_release, accepted_commit, coalesce(last_observed_at, updated_at),
       CASE observed_state WHEN 'active' THEN 'current' WHEN 'missing' THEN 'deleted'
         WHEN 'unavailable' THEN 'unavailable' ELSE 'stale' END,
       NULL, 'hermes-profile-safe/v1', digest(id || ':' || native_reference || ':' || coalesce(source_version, ''), 'sha256'),
       name, description, protected,
       CASE WHEN desired_state = 'deleted' THEN 'deleted'
         WHEN observed_state IN ('active','inactive','missing','unavailable') THEN observed_state
         ELSE 'inactive' END,
       id
FROM candidates
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace, alias_value, alias_kind, source_reference)
SELECT projection.framework_id, 'profile', projection.agent_profile_id, 'core.profiles.id', projection.predecessor_profile_id,
       'predecessor-core', 'core.profiles'
FROM core.agent_profile_projections projection
ON CONFLICT DO NOTHING;

WITH candidates AS (
  SELECT operation.*, framework.id AS mapped_framework_id,
         profile_projection.agent_profile_id AS mapped_profile_id,
         core.generate_alica_id('op') AS canonical_id
  FROM core.operations operation
  LEFT JOIN core.frameworks framework
    ON operation.target_kind = 'framework' AND framework.id = operation.target_id
  LEFT JOIN core.agent_profile_projections profile_projection
    ON operation.target_kind = 'profile' AND profile_projection.predecessor_profile_id = operation.target_id
  WHERE framework.id IS NOT NULL OR profile_projection.agent_profile_id IS NOT NULL
)
INSERT INTO core.framework_operations
  (operation_id, predecessor_operation_id, framework_id, agent_profile_id, command_id,
   actor_predecessor_reference, capability_key, mode, idempotency_key, request_digest,
   authorization_state, state, retention_policy_key, requested_at, terminal_at)
SELECT canonical_id, id, coalesce(mapped_framework_id,
       (SELECT framework_id FROM core.agent_profile_projections WHERE agent_profile_id = mapped_profile_id)),
       mapped_profile_id, command_id, actor_kind || ':' || actor_id,
       command_type, 'execute', idempotency_key, payload_digest,
       'held', CASE status WHEN 'succeeded' THEN 'completed' WHEN 'failed' THEN 'failed'
         WHEN 'cancelled' THEN 'cancelled' WHEN 'running' THEN 'dispatched' ELSE 'requested' END,
       'operations-evidence-default/v1', accepted_at, finished_at
FROM candidates
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace, alias_value, alias_kind, source_reference)
SELECT operation.framework_id, 'operation', operation.operation_id, 'core.operations.id', operation.predecessor_operation_id,
       'predecessor-core', 'core.operations'
FROM core.framework_operations operation
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_event_receipts
  (framework_id, stream_key, owner_event_id, payload_digest, source_version,
   canonical_event_id, classification_schema_key, received_at)
SELECT receipt.source_framework_id, 'core.inbound', receipt.source_event_id, receipt.payload_digest,
       'predecessor-unversioned', NULL, 'digest-only/v1', receipt.received_at
FROM core.inbound_receipts receipt
JOIN core.framework_instance_metadata metadata ON metadata.framework_id = receipt.source_framework_id
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_predecessor_holds
  (hold_id, predecessor_schema, predecessor_table, predecessor_key, framework_id, reason_code, evidence_digest)
SELECT core.generate_alica_id('hld'), 'core', 'conversations', conversation.id, profile.framework_id,
       'CHAT_OWNERSHIP_UNRESOLVED', digest(conversation.id || ':' || conversation.ownership, 'sha256')
FROM core.conversations conversation
JOIN core.profiles profile ON profile.id = conversation.profile_id
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_predecessor_holds
  (hold_id, predecessor_schema, predecessor_table, predecessor_key, framework_id, reason_code, evidence_digest)
SELECT core.generate_alica_id('hld'), 'core', 'conversation_dispatches', dispatch.id, profile.framework_id,
       'RUN_CLASS_AMBIGUOUS', digest(dispatch.id || ':conversation_dispatch', 'sha256')
FROM core.conversation_dispatches dispatch
JOIN core.profiles profile ON profile.id = dispatch.profile_id
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_predecessor_holds
  (hold_id, predecessor_schema, predecessor_table, predecessor_key, framework_id, reason_code, evidence_digest)
SELECT core.generate_alica_id('hld'), 'core', 'work_runs', run.id, profile.framework_id,
       'RUN_CLASS_AMBIGUOUS', digest(run.id || ':work_run', 'sha256')
FROM core.work_runs run
JOIN core.work_schedules schedule ON schedule.id = run.schedule_id
LEFT JOIN core.work_projects project ON project.id = schedule.project_id
LEFT JOIN core.work_tasks task ON task.id = schedule.task_id
LEFT JOIN core.profiles profile ON profile.id = coalesce(project.project_manager_profile_id,
  (SELECT member.profile_id FROM core.work_project_profiles member
   WHERE member.project_id = coalesce(project.id, task.project_id) ORDER BY member.created_at LIMIT 1))
WHERE profile.framework_id IS NOT NULL
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF to_regclass('public.framework_registrations') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO core.framework_native_aliases
        (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace, alias_value, alias_kind, source_reference)
      SELECT policy.framework_id, 'framework', policy.framework_id, 'gateway.framework_registrations.id', registration.id,
             'predecessor-gateway', 'public.framework_registrations'
      FROM public.framework_registrations registration
      JOIN core.framework_gateway_policies policy ON policy.expected_native_framework_id = registration.id
      ON CONFLICT DO NOTHING
    $sql$;
    EXECUTE $sql$
      INSERT INTO core.framework_predecessor_holds
        (hold_id, predecessor_schema, predecessor_table, predecessor_key, framework_id, reason_code, evidence_digest)
      SELECT core.generate_alica_id('hld'), 'public', 'framework_registrations', registration.id,
             policy.framework_id, 'IDENTITY_CONTEXT_MISSING', digest(registration.id || ':' || registration.adapter_id, 'sha256')
      FROM public.framework_registrations registration
      JOIN core.framework_gateway_policies policy ON policy.expected_native_framework_id = registration.id
      ON CONFLICT DO NOTHING
    $sql$;
  END IF;
  IF to_regclass('public.event_cursors') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO core.framework_event_stream_state
        (framework_id, stream_key, owner_cursor, state, safe_error_code)
      SELECT policy.framework_id, cursor.bridge_id, cursor.durable_cursor,
             CASE cursor.replay_state WHEN 'replaying' THEN 'replaying' WHEN 'current' THEN 'current'
               WHEN 'gap' THEN 'gap' WHEN 'unavailable' THEN 'unavailable' ELSE 'idle' END,
             'PREDECESSOR_CURSOR_HELD'
      FROM public.event_cursors cursor
      JOIN core.framework_gateway_policies policy ON cursor.bridge_id = policy.expected_native_framework_id
      ON CONFLICT DO NOTHING
    $sql$;
  END IF;
END
$$;

INSERT INTO core.framework_migration_evidence
  (evidence_id, migration_contract, action, source_digest, result_digest)
SELECT core.generate_alica_id('evd'), 'alica-hermes-projection-migration/v0.1', 'initial-backfill',
       digest((SELECT count(*)::text FROM core.frameworks) || ':' ||
              (SELECT count(*)::text FROM core.profiles) || ':' ||
              (SELECT count(*)::text FROM core.operations), 'sha256'),
       digest((SELECT count(*)::text FROM core.framework_native_aliases) || ':' ||
              (SELECT count(*)::text FROM core.agent_profile_projections) || ':' ||
              (SELECT count(*)::text FROM core.framework_operations), 'sha256');
