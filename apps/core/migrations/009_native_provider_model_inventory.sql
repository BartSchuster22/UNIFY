ALTER TABLE core.providers
  ADD COLUMN native_reference text CHECK (native_reference IS NULL OR length(native_reference) BETWEEN 1 AND 200),
  ADD COLUMN authentication_method text NOT NULL DEFAULT 'framework-managed'
    CHECK (authentication_method IN ('none','api-key','oauth2','framework-managed')),
  ADD COLUMN credential_state text NOT NULL DEFAULT 'unknown'
    CHECK (credential_state IN ('not-required','missing','configured','invalid','unknown')),
  ADD COLUMN credential_requirements jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(credential_requirements) = 'object'),
  ADD COLUMN selected_default boolean NOT NULL DEFAULT false,
  ADD COLUMN source_version text CHECK (source_version IS NULL OR length(source_version) <= 256),
  ADD COLUMN last_observed_at timestamptz;
UPDATE core.providers SET native_reference=provider_key WHERE native_reference IS NULL;
ALTER TABLE core.providers ALTER COLUMN native_reference SET NOT NULL;
CREATE UNIQUE INDEX providers_one_selected_default
  ON core.providers (framework_id) WHERE selected_default;

ALTER TABLE core.providers ADD CONSTRAINT providers_id_framework_unique UNIQUE (id,framework_id);

ALTER TABLE core.models
  ADD COLUMN framework_id text REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  ADD COLUMN aliases text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(aliases) <= 100),
  ADD COLUMN desired_state text NOT NULL DEFAULT 'enabled'
    CHECK (desired_state IN ('enabled','disabled','retired')),
  ADD COLUMN selected_default boolean NOT NULL DEFAULT false,
  ADD COLUMN selectable boolean NOT NULL DEFAULT false,
  ADD COLUMN source_version text CHECK (source_version IS NULL OR length(source_version) <= 256),
  ADD COLUMN observed_at timestamptz;
UPDATE core.models model SET framework_id=provider.framework_id
FROM core.providers provider WHERE provider.id=model.provider_id;
ALTER TABLE core.models ALTER COLUMN framework_id SET NOT NULL;
ALTER TABLE core.models ADD CONSTRAINT models_provider_framework_fk
  FOREIGN KEY (provider_id,framework_id) REFERENCES core.providers(id,framework_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX models_one_selected_default_per_framework
  ON core.models (framework_id) WHERE selected_default;

ALTER TABLE core.model_routing_candidates
  ADD COLUMN required_capabilities text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(required_capabilities) <= 20),
  ADD COLUMN enabled boolean NOT NULL DEFAULT true;

CREATE TABLE core.model_catalog_snapshots (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'mcs')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  provider_source_version text NOT NULL CHECK (length(provider_source_version) BETWEEN 1 AND 256),
  model_source_version text NOT NULL CHECK (length(model_source_version) BETWEEN 1 AND 256),
  observed_at timestamptz NOT NULL,
  provider_count integer NOT NULL CHECK (provider_count >= 0),
  model_count integer NOT NULL CHECK (model_count >= 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX model_catalog_snapshots_latest
  ON core.model_catalog_snapshots (framework_id, created_at DESC);
CREATE TRIGGER model_catalog_snapshots_immutable BEFORE UPDATE OR DELETE
ON core.model_catalog_snapshots FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.provider_validation_evidence (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'pvl')),
  provider_id text NOT NULL REFERENCES core.providers(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','service')),
  actor_id text NOT NULL,
  request_id text NOT NULL CHECK (core.is_canonical_id(request_id, 'req')),
  correlation_id text NOT NULL CHECK (core.is_canonical_id(correlation_id, 'cor')),
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 256),
  outcome text NOT NULL CHECK (outcome IN ('valid','invalid','unavailable')),
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  validated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT provider_validation_actor CHECK (core.is_principal_id(actor_kind, actor_id))
);
CREATE INDEX provider_validation_evidence_latest
  ON core.provider_validation_evidence (provider_id, validated_at DESC);
CREATE TRIGGER provider_validation_evidence_immutable BEFORE UPDATE OR DELETE
ON core.provider_validation_evidence FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.model_reconciliations (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'rec')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','service')),
  actor_id text NOT NULL,
  request_id text NOT NULL CHECK (core.is_canonical_id(request_id, 'req')),
  correlation_id text NOT NULL CHECK (core.is_canonical_id(correlation_id, 'cor')),
  provider_source_version text NOT NULL CHECK (length(provider_source_version) BETWEEN 1 AND 256),
  model_source_version text NOT NULL CHECK (length(model_source_version) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (status IN ('converged','drifted','failed')),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT model_reconciliation_actor CHECK (core.is_principal_id(actor_kind, actor_id))
);
CREATE INDEX model_reconciliations_latest
  ON core.model_reconciliations (framework_id, created_at DESC);
CREATE TRIGGER model_reconciliations_immutable BEFORE UPDATE OR DELETE
ON core.model_reconciliations FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.model_policy_evidence (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'mev')),
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE RESTRICT,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','service')),
  actor_id text NOT NULL,
  request_id text NOT NULL CHECK (core.is_canonical_id(request_id, 'req')),
  correlation_id text NOT NULL CHECK (core.is_canonical_id(correlation_id, 'cor')),
  expected_version bigint,
  resulting_version bigint NOT NULL,
  candidates jsonb NOT NULL CHECK (jsonb_typeof(candidates) = 'array'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT model_policy_actor CHECK (core.is_principal_id(actor_kind, actor_id))
);
CREATE INDEX model_policy_evidence_latest
  ON core.model_policy_evidence (profile_id, occurred_at DESC);
CREATE TRIGGER model_policy_evidence_immutable BEFORE UPDATE OR DELETE
ON core.model_policy_evidence FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
