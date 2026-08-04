CREATE TABLE core.agents (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'agt')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  native_reference text NOT NULL CHECK (length(native_reference) BETWEEN 1 AND 500),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  desired_state text NOT NULL DEFAULT 'active' CHECK (desired_state IN ('active', 'inactive', 'deleted')),
  observed_state text NOT NULL DEFAULT 'unknown' CHECK (observed_state IN ('unknown', 'active', 'inactive', 'missing', 'unavailable')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (framework_id, native_reference)
);
CREATE TRIGGER agents_bump_version BEFORE UPDATE ON core.agents
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.profiles (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'prf')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  native_reference text NOT NULL CHECK (length(native_reference) BETWEEN 1 AND 500),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 5000),
  protected boolean NOT NULL DEFAULT false,
  desired_state text NOT NULL DEFAULT 'active' CHECK (desired_state IN ('active', 'inactive', 'deleted')),
  observed_state text NOT NULL DEFAULT 'unknown' CHECK (observed_state IN ('unknown', 'active', 'inactive', 'missing', 'unavailable')),
  observed_version text CHECK (observed_version IS NULL OR length(observed_version) <= 500),
  source_version text CHECK (source_version IS NULL OR length(source_version) <= 256),
  last_observed_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (framework_id, native_reference)
);
CREATE INDEX profiles_framework_inventory ON core.profiles (framework_id, desired_state, observed_state, name);
CREATE TRIGGER profiles_bump_version BEFORE UPDATE ON core.profiles
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.profile_assignments (
  agent_id text NOT NULL REFERENCES core.agents(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'fallback')),
  desired_state text NOT NULL DEFAULT 'assigned' CHECK (desired_state IN ('assigned', 'unassigned')),
  observed_state text NOT NULL DEFAULT 'unknown' CHECK (observed_state IN ('unknown', 'assigned', 'unassigned', 'conflict')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (agent_id, profile_id)
);
CREATE UNIQUE INDEX profile_assignments_one_primary
  ON core.profile_assignments (agent_id)
  WHERE role = 'primary' AND desired_state = 'assigned';
CREATE TRIGGER profile_assignments_bump_version BEFORE UPDATE ON core.profile_assignments
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.profile_inventory_observations (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'pob')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 256),
  observed_at timestamptz NOT NULL,
  item_count integer NOT NULL CHECK (item_count >= 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX profile_inventory_observations_latest
  ON core.profile_inventory_observations (framework_id, received_at DESC);
CREATE TRIGGER profile_inventory_observations_immutable BEFORE UPDATE OR DELETE
ON core.profile_inventory_observations FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.profile_reconciliations (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'rec')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service')),
  actor_id text NOT NULL,
  request_id text NOT NULL CHECK (core.is_canonical_id(request_id, 'req')),
  correlation_id text NOT NULL CHECK (core.is_canonical_id(correlation_id, 'cor')),
  expected_source_version text CHECK (expected_source_version IS NULL OR length(expected_source_version) <= 256),
  observed_source_version text NOT NULL CHECK (length(observed_source_version) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (status IN ('converged', 'drifted', 'failed')),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT profile_reconciliation_actor CHECK (core.is_principal_id(actor_kind, actor_id))
);
CREATE INDEX profile_reconciliations_latest
  ON core.profile_reconciliations (framework_id, created_at DESC);
CREATE TRIGGER profile_reconciliations_immutable BEFORE UPDATE OR DELETE
ON core.profile_reconciliations FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.profile_lifecycle_evidence (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'pev')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  profile_id text REFERENCES core.profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('create', 'update', 'delete', 'assign', 'unassign', 'reconcile')),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service')),
  actor_id text NOT NULL,
  request_id text NOT NULL CHECK (core.is_canonical_id(request_id, 'req')),
  correlation_id text NOT NULL CHECK (core.is_canonical_id(correlation_id, 'cor')),
  expected_version bigint,
  resulting_version bigint,
  source_version text CHECK (source_version IS NULL OR length(source_version) <= 256),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT profile_evidence_actor CHECK (core.is_principal_id(actor_kind, actor_id))
);
CREATE INDEX profile_lifecycle_evidence_resource
  ON core.profile_lifecycle_evidence (profile_id, occurred_at DESC);
CREATE TRIGGER profile_lifecycle_evidence_immutable BEFORE UPDATE OR DELETE
ON core.profile_lifecycle_evidence FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

INSERT INTO core.authorization_permissions (permission_key, description) VALUES
  ('profiles.read', 'Read native agent, profile, assignment, and reconciliation state.'),
  ('profiles.manage', 'Manage native profile lifecycle and assignments.')
ON CONFLICT DO NOTHING;

INSERT INTO core.authorization_role_permissions (role_key, permission_key) VALUES
  ('core.admin', 'profiles.read'),
  ('core.admin', 'profiles.manage'),
  ('core.operator', 'profiles.read'),
  ('core.operator', 'profiles.manage'),
  ('core.viewer', 'profiles.read')
ON CONFLICT DO NOTHING;
