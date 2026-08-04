ALTER TABLE core.identities
  ADD COLUMN password_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN require_password_change boolean NOT NULL DEFAULT false;

ALTER TABLE core.identity_sessions
  ADD COLUMN mfa_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN authentication_method text NOT NULL DEFAULT 'password' CHECK (authentication_method IN ('password', 'password-mfa')),
  ADD COLUMN revocation_reason text CHECK (revocation_reason IS NULL OR length(revocation_reason) BETWEEN 1 AND 200);

ALTER TABLE core.mfa_enrollments
  ADD COLUMN last_verified_counter bigint CHECK (last_verified_counter IS NULL OR last_verified_counter >= 0);

CREATE TABLE core.password_history (
  identity_id text NOT NULL REFERENCES core.identities(id) ON DELETE CASCADE,
  ordinal bigint GENERATED ALWAYS AS IDENTITY,
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  replaced_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (identity_id, ordinal)
);
CREATE INDEX password_history_recent
  ON core.password_history (identity_id, replaced_at DESC, ordinal DESC);

CREATE TABLE core.authentication_throttles (
  bucket_digest bytea PRIMARY KEY CHECK (octet_length(bucket_digest) = 32),
  bucket_kind text NOT NULL CHECK (bucket_kind IN ('identity', 'network', 'identity-network')),
  window_started_at timestamptz NOT NULL,
  failure_count integer NOT NULL CHECK (failure_count > 0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT authentication_throttle_block CHECK (blocked_until IS NULL OR blocked_until >= window_started_at)
);
CREATE INDEX authentication_throttles_cleanup
  ON core.authentication_throttles (updated_at);
CREATE INDEX authentication_throttles_blocked
  ON core.authentication_throttles (blocked_until)
  WHERE blocked_until IS NOT NULL;

CREATE TABLE core.authentication_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  completed_at timestamptz,
  identity_id text UNIQUE REFERENCES core.identities(id) ON DELETE RESTRICT,
  CONSTRAINT authentication_bootstrap_completion CHECK (
    (completed_at IS NULL AND identity_id IS NULL) OR
    (completed_at IS NOT NULL AND identity_id IS NOT NULL)
  )
);
INSERT INTO core.authentication_bootstrap (singleton) VALUES (true)
ON CONFLICT DO NOTHING;

CREATE TABLE core.authentication_key_versions (
  purpose text NOT NULL CHECK (purpose IN ('mfa-encryption')),
  key_version integer NOT NULL CHECK (key_version > 0),
  activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz,
  PRIMARY KEY (purpose, key_version),
  CONSTRAINT authentication_key_retirement CHECK (retired_at IS NULL OR retired_at > activated_at)
);
INSERT INTO core.authentication_key_versions (purpose, key_version)
VALUES ('mfa-encryption', 1)
ON CONFLICT DO NOTHING;

INSERT INTO core.service_principals (id, name, status)
VALUES ('svc_00000000000000000000000001', 'unify-core-authentication', 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO core.authorization_permissions (permission_key, description) VALUES
  ('authorization.read', 'Read scoped authorization policy.'),
  ('authorization.manage', 'Manage scoped authorization policy.'),
  ('service-credentials.read', 'Read service credential metadata.'),
  ('service-credentials.manage', 'Issue and revoke service credentials.'),
  ('identity.sessions.manage', 'Revoke identity sessions.'),
  ('identity.accounts.manage', 'Lock, unlock, and manage identity accounts.')
ON CONFLICT DO NOTHING;

INSERT INTO core.authorization_role_permissions (role_key, permission_key)
SELECT 'core.admin', permission_key
FROM core.authorization_permissions
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION core.authentication_throttle_failure(
  digest_value bytea,
  kind_value text,
  observed_at timestamptz,
  window_seconds integer,
  threshold_value integer,
  block_seconds integer
)
RETURNS TABLE(failure_count integer, blocked_until timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
  IF octet_length(digest_value) <> 32
     OR kind_value NOT IN ('identity', 'network', 'identity-network')
     OR window_seconds < 1
     OR threshold_value < 1
     OR block_seconds < 1 THEN
    RAISE EXCEPTION 'invalid authentication throttle input' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  INSERT INTO core.authentication_throttles AS throttle
    (bucket_digest, bucket_kind, window_started_at, failure_count, blocked_until, updated_at)
  VALUES
    (digest_value, kind_value, observed_at, 1, NULL, observed_at)
  ON CONFLICT (bucket_digest) DO UPDATE SET
    bucket_kind = EXCLUDED.bucket_kind,
    window_started_at = CASE
      WHEN throttle.window_started_at + make_interval(secs => window_seconds) <= observed_at
      THEN observed_at ELSE throttle.window_started_at END,
    failure_count = CASE
      WHEN throttle.window_started_at + make_interval(secs => window_seconds) <= observed_at
      THEN 1 ELSE throttle.failure_count + 1 END,
    blocked_until = CASE
      WHEN (
        CASE WHEN throttle.window_started_at + make_interval(secs => window_seconds) <= observed_at
          THEN 1 ELSE throttle.failure_count + 1 END
      ) >= threshold_value
      THEN greatest(
        coalesce(throttle.blocked_until, observed_at),
        observed_at + make_interval(secs => block_seconds)
      )
      ELSE throttle.blocked_until END,
    updated_at = observed_at
  RETURNING throttle.failure_count, throttle.blocked_until;
END;
$$;

REVOKE EXECUTE ON FUNCTION core.authentication_throttle_failure(bytea, text, timestamptz, integer, integer, integer) FROM PUBLIC;
