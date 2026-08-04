CREATE TABLE core.identities (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'usr')),
  username text NOT NULL CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$'),
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'disabled')),
  mfa_enabled boolean NOT NULL DEFAULT false,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT identities_lock_consistency CHECK (status = 'locked' OR locked_until IS NULL)
);
CREATE UNIQUE INDEX identities_username_unique ON core.identities (lower(username));
CREATE TRIGGER identities_bump_version BEFORE UPDATE ON core.identities
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();
CREATE TRIGGER identities_prevent_delete BEFORE DELETE ON core.identities
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.identity_sessions (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'ses')),
  identity_id text NOT NULL REFERENCES core.identities(id) ON DELETE CASCADE,
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  csrf_digest bytea NOT NULL CHECK (octet_length(csrf_digest) = 32),
  device_label text CHECK (device_label IS NULL OR length(device_label) BETWEEN 1 AND 200),
  remote_address inet,
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT identity_sessions_expiry CHECK (expires_at > created_at),
  CONSTRAINT identity_sessions_seen CHECK (last_seen_at >= created_at),
  CONSTRAINT identity_sessions_revoked CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX identity_sessions_active_by_identity
  ON core.identity_sessions (identity_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE TRIGGER identity_sessions_bump_version BEFORE UPDATE ON core.identity_sessions
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.mfa_enrollments (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'mfa')),
  identity_id text NOT NULL REFERENCES core.identities(id) ON DELETE CASCADE,
  secret_ciphertext bytea NOT NULL CHECK (octet_length(secret_ciphertext) >= 32),
  secret_key_version integer NOT NULL CHECK (secret_key_version > 0),
  state text NOT NULL CHECK (state IN ('pending', 'active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mfa_enrollment_times CHECK (
    expires_at > created_at
    AND (confirmed_at IS NULL OR confirmed_at >= created_at)
    AND (revoked_at IS NULL OR revoked_at >= created_at)
  )
);
CREATE UNIQUE INDEX mfa_one_active_per_identity
  ON core.mfa_enrollments (identity_id)
  WHERE state = 'active';
CREATE TRIGGER mfa_enrollments_bump_version BEFORE UPDATE ON core.mfa_enrollments
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.mfa_recovery_codes (
  enrollment_id text NOT NULL REFERENCES core.mfa_enrollments(id) ON DELETE CASCADE,
  ordinal smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 20),
  code_digest bytea NOT NULL CHECK (octet_length(code_digest) = 32),
  used_at timestamptz,
  PRIMARY KEY (enrollment_id, ordinal),
  UNIQUE (enrollment_id, code_digest)
);

CREATE TABLE core.service_principals (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'svc')),
  name text NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER service_principals_bump_version BEFORE UPDATE ON core.service_principals
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();
CREATE TRIGGER service_principals_prevent_delete BEFORE DELETE ON core.service_principals
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.service_credentials (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'crd')),
  service_id text NOT NULL REFERENCES core.service_principals(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
  scopes text[] NOT NULL CHECK (cardinality(scopes) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT service_credentials_expiry CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT service_credentials_revoked CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX service_credentials_active_by_service
  ON core.service_credentials (service_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE TRIGGER service_credentials_bump_version BEFORE UPDATE ON core.service_credentials
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.authorization_roles (
  role_key text PRIMARY KEY CHECK (role_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE core.authorization_permissions (
  permission_key text PRIMARY KEY CHECK (permission_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE core.authorization_role_permissions (
  role_key text NOT NULL REFERENCES core.authorization_roles(role_key) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES core.authorization_permissions(permission_key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE core.authorization_bindings (
  principal_kind text NOT NULL CHECK (principal_kind IN ('user', 'service')),
  principal_id text NOT NULL,
  role_key text NOT NULL REFERENCES core.authorization_roles(role_key) ON DELETE RESTRICT,
  scope_kind text NOT NULL CHECK (scope_kind IN ('global', 'framework', 'profile', 'project')),
  scope_id text,
  granted_by_kind text NOT NULL CHECK (granted_by_kind IN ('user', 'service')),
  granted_by_id text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  PRIMARY KEY (principal_kind, principal_id, role_key, scope_kind, scope_id),
  CONSTRAINT authorization_binding_principal CHECK (core.is_principal_id(principal_kind, principal_id)),
  CONSTRAINT authorization_binding_grantor CHECK (core.is_principal_id(granted_by_kind, granted_by_id)),
  CONSTRAINT authorization_binding_scope CHECK (
    (scope_kind = 'global' AND scope_id = 'global') OR
    (scope_kind = 'framework' AND core.is_canonical_id(scope_id, 'frm')) OR
    (scope_kind = 'profile' AND core.is_canonical_id(scope_id, 'prf')) OR
    (scope_kind = 'project' AND core.is_canonical_id(scope_id, 'prj'))
  ),
  CONSTRAINT authorization_binding_expiry CHECK (expires_at IS NULL OR expires_at > granted_at)
);
CREATE OR REPLACE FUNCTION core.principal_exists(kind text, value text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
STRICT
AS $$
BEGIN
  IF kind = 'user' THEN
    RETURN EXISTS (SELECT 1 FROM core.identities WHERE id = value);
  ELSIF kind = 'service' THEN
    RETURN EXISTS (SELECT 1 FROM core.service_principals WHERE id = value);
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION core.validate_authorization_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT core.principal_exists(NEW.principal_kind, NEW.principal_id) THEN
    RAISE EXCEPTION 'authorization principal does not exist' USING ERRCODE = '23503';
  END IF;
  IF NOT core.principal_exists(NEW.granted_by_kind, NEW.granted_by_id) THEN
    RAISE EXCEPTION 'authorization grantor does not exist' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER authorization_bindings_validate BEFORE INSERT OR UPDATE ON core.authorization_bindings
FOR EACH ROW EXECUTE FUNCTION core.validate_authorization_binding();

CREATE INDEX authorization_bindings_lookup
  ON core.authorization_bindings (principal_kind, principal_id, scope_kind, scope_id)
  INCLUDE (role_key, expires_at);

INSERT INTO core.authorization_permissions (permission_key, description) VALUES
  ('identity.read', 'Read identity metadata.'),
  ('identity.manage', 'Manage identity security state.'),
  ('frameworks.read', 'Read framework state.'),
  ('frameworks.manage', 'Manage framework desired state.'),
  ('models.read', 'Read provider and model inventory.'),
  ('models.manage', 'Manage provider and model policy.'),
  ('operations.read', 'Read operation state.'),
  ('operations.manage', 'Control operations.'),
  ('notifications.read', 'Read notifications.'),
  ('audit.read', 'Read audit records.')
ON CONFLICT DO NOTHING;

INSERT INTO core.authorization_roles (role_key, description, is_system) VALUES
  ('core.admin', 'Full Core administration.', true),
  ('core.operator', 'Operate frameworks, models and operations.', true),
  ('core.viewer', 'Read authorized Core state.', true)
ON CONFLICT DO NOTHING;

INSERT INTO core.authorization_role_permissions (role_key, permission_key)
SELECT 'core.admin', permission_key FROM core.authorization_permissions
ON CONFLICT DO NOTHING;

INSERT INTO core.authorization_role_permissions (role_key, permission_key) VALUES
  ('core.operator', 'frameworks.read'),
  ('core.operator', 'frameworks.manage'),
  ('core.operator', 'models.read'),
  ('core.operator', 'models.manage'),
  ('core.operator', 'operations.read'),
  ('core.operator', 'operations.manage'),
  ('core.operator', 'notifications.read'),
  ('core.viewer', 'frameworks.read'),
  ('core.viewer', 'models.read'),
  ('core.viewer', 'operations.read'),
  ('core.viewer', 'notifications.read')
ON CONFLICT DO NOTHING;
