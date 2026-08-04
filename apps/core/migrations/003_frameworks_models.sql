CREATE TABLE core.frameworks (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'frm')),
  name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 200),
  endpoint text NOT NULL CHECK (endpoint ~ '^https://'),
  credential_reference text NOT NULL CHECK (credential_reference ~ '^secret://[A-Za-z0-9._/-]+$'),
  desired_state text NOT NULL DEFAULT 'active' CHECK (desired_state IN ('active', 'disabled')),
  observed_state text NOT NULL DEFAULT 'unknown' CHECK (observed_state IN ('unknown', 'available', 'degraded', 'unavailable', 'disabled')),
  observed_version text,
  last_health_at timestamptz,
  last_health_detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(last_health_detail) = 'object'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER frameworks_bump_version BEFORE UPDATE ON core.frameworks
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.framework_capability_documents (
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  document_version bigint NOT NULL CHECK (document_version > 0),
  protocol text NOT NULL CHECK (protocol = 'hermes-control'),
  protocol_version text NOT NULL CHECK (protocol_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  framework_version text NOT NULL CHECK (framework_version ~ '^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$'),
  schema_digest bytea NOT NULL CHECK (octet_length(schema_digest) = 32),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (framework_id, document_version),
  UNIQUE (framework_id, schema_digest),
  CONSTRAINT framework_capability_expiry CHECK (expires_at > issued_at)
);
CREATE TRIGGER framework_capability_documents_immutable
BEFORE UPDATE OR DELETE ON core.framework_capability_documents
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_capability_negotiations (
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  negotiation_version bigint NOT NULL CHECK (negotiation_version > 0),
  document_version bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted', 'degraded', 'rejected')),
  requirements jsonb NOT NULL CHECK (jsonb_typeof(requirements) = 'array'),
  effective_capabilities jsonb NOT NULL CHECK (jsonb_typeof(effective_capabilities) = 'array'),
  rejections jsonb NOT NULL CHECK (jsonb_typeof(rejections) = 'array'),
  negotiated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (framework_id, negotiation_version),
  FOREIGN KEY (framework_id, document_version)
    REFERENCES core.framework_capability_documents(framework_id, document_version) ON DELETE RESTRICT,
  CONSTRAINT framework_negotiation_expiry CHECK (expires_at > negotiated_at)
);
CREATE INDEX framework_negotiations_current
  ON core.framework_capability_negotiations (framework_id, negotiation_version DESC);
CREATE TRIGGER framework_capability_negotiations_immutable
BEFORE UPDATE OR DELETE ON core.framework_capability_negotiations
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.providers (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'pvd')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z0-9][a-z0-9._-]{1,127}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  credential_reference text CHECK (credential_reference IS NULL OR credential_reference ~ '^secret://[A-Za-z0-9._/-]+$'),
  desired_state text NOT NULL DEFAULT 'active' CHECK (desired_state IN ('active', 'disabled')),
  observed_state text NOT NULL DEFAULT 'unknown' CHECK (observed_state IN ('unknown', 'available', 'invalid', 'unavailable', 'disabled')),
  validated_at timestamptz,
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (framework_id, provider_key)
);
CREATE TRIGGER providers_bump_version BEFORE UPDATE ON core.providers
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.models (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'mdl')),
  provider_id text NOT NULL REFERENCES core.providers(id) ON DELETE RESTRICT,
  model_key text NOT NULL CHECK (length(model_key) BETWEEN 1 AND 300),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 300),
  capabilities text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(capabilities) <= 100),
  context_window integer CHECK (context_window IS NULL OR context_window > 0),
  max_output_tokens integer CHECK (max_output_tokens IS NULL OR max_output_tokens > 0),
  observed_state text NOT NULL DEFAULT 'available' CHECK (observed_state IN ('available', 'unavailable', 'retired')),
  inventory_revision bigint NOT NULL CHECK (inventory_revision > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider_id, model_key)
);
CREATE INDEX models_available ON core.models (provider_id, model_key) WHERE observed_state = 'available';
CREATE TRIGGER models_bump_version BEFORE UPDATE ON core.models
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.model_routing_policies (
  profile_id text PRIMARY KEY CHECK (core.is_canonical_id(profile_id, 'prf')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER model_routing_policies_bump_version BEFORE UPDATE ON core.model_routing_policies
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.model_routing_candidates (
  profile_id text NOT NULL REFERENCES core.model_routing_policies(profile_id) ON DELETE CASCADE,
  priority smallint NOT NULL CHECK (priority BETWEEN 0 AND 99),
  model_id text NOT NULL REFERENCES core.models(id) ON DELETE RESTRICT,
  is_required boolean NOT NULL DEFAULT false,
  PRIMARY KEY (profile_id, priority),
  UNIQUE (profile_id, model_id)
);
