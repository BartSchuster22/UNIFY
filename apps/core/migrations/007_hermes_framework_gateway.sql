CREATE UNIQUE INDEX frameworks_gateway_endpoint_unique
  ON core.frameworks (endpoint);

CREATE UNIQUE INDEX frameworks_gateway_credential_reference_unique
  ON core.frameworks (credential_reference);

ALTER TABLE core.framework_capability_documents
  DROP CONSTRAINT framework_capability_documents_framework_id_schema_digest_key;
CREATE INDEX framework_capability_documents_schema_digest
  ON core.framework_capability_documents (framework_id, schema_digest);

CREATE TABLE core.framework_gateway_policies (
  framework_id text PRIMARY KEY REFERENCES core.frameworks(id) ON DELETE CASCADE,
  expected_native_framework_id text NOT NULL CHECK (expected_native_framework_id ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  expected_instance_id text NOT NULL CHECK (length(expected_instance_id) BETWEEN 1 AND 200),
  expected_release text NOT NULL CHECK (expected_release ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  expected_commit text NOT NULL CHECK (expected_commit ~ '^[a-f0-9]{40}$'),
  request_timeout_ms integer NOT NULL DEFAULT 5000 CHECK (request_timeout_ms BETWEEN 100 AND 60000),
  retry_limit smallint NOT NULL DEFAULT 2 CHECK (retry_limit BETWEEN 0 AND 5),
  retry_base_delay_ms integer NOT NULL DEFAULT 100 CHECK (retry_base_delay_ms BETWEEN 10 AND 5000),
  maximum_response_bytes integer NOT NULL DEFAULT 2097152 CHECK (maximum_response_bytes BETWEEN 1024 AND 16777216),
  circuit_failure_threshold smallint NOT NULL DEFAULT 3 CHECK (circuit_failure_threshold BETWEEN 1 AND 20),
  circuit_open_ms integer NOT NULL DEFAULT 30000 CHECK (circuit_open_ms BETWEEN 1000 AND 3600000),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (expected_native_framework_id),
  UNIQUE (expected_instance_id)
);
CREATE TRIGGER framework_gateway_policies_bump_version BEFORE UPDATE ON core.framework_gateway_policies
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.framework_gateway_runtime (
  framework_id text PRIMARY KEY REFERENCES core.frameworks(id) ON DELETE CASCADE,
  circuit_state text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed', 'open', 'half-open')),
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  opened_at timestamptz,
  next_attempt_at timestamptz,
  probe_lease_until timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_safe_error_code text CHECK (last_safe_error_code IS NULL OR last_safe_error_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  active_credential_version text CHECK (active_credential_version IS NULL OR length(active_credential_version) BETWEEN 1 AND 128),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT framework_gateway_open_state CHECK (
    (circuit_state = 'closed' AND opened_at IS NULL AND next_attempt_at IS NULL) OR
    (circuit_state IN ('open', 'half-open') AND opened_at IS NOT NULL AND next_attempt_at IS NOT NULL)
  )
);

CREATE TABLE core.framework_gateway_observations (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'fob')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('identity', 'version', 'health', 'capabilities')),
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 256),
  credential_version text NOT NULL CHECK (length(credential_version) BETWEEN 1 AND 128),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  observed_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX framework_gateway_observations_latest
  ON core.framework_gateway_observations (framework_id, kind, received_at DESC);
CREATE TRIGGER framework_gateway_observations_immutable
BEFORE UPDATE OR DELETE ON core.framework_gateway_observations
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_gateway_token_rotations (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'rot')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  previous_version text NOT NULL CHECK (length(previous_version) BETWEEN 1 AND 128),
  active_version text NOT NULL CHECK (length(active_version) BETWEEN 1 AND 128),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (previous_version <> active_version)
);
CREATE INDEX framework_gateway_token_rotations_latest
  ON core.framework_gateway_token_rotations (framework_id, observed_at DESC);
CREATE TRIGGER framework_gateway_token_rotations_immutable
BEFORE UPDATE OR DELETE ON core.framework_gateway_token_rotations
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
