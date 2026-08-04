CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.schema_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  name text NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9_]+$'),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE OR REPLACE FUNCTION core.is_canonical_id(value text, prefix text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT value ~ ('^' || prefix || '_[0-9A-HJKMNP-TV-Z]{26}$');
$$;

CREATE OR REPLACE FUNCTION core.is_any_canonical_id(value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT value ~ '^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$';
$$;

CREATE OR REPLACE FUNCTION core.is_principal_id(kind text, value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE kind
    WHEN 'user' THEN core.is_canonical_id(value, 'usr')
    WHEN 'service' THEN core.is_canonical_id(value, 'svc')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION core.bump_resource_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'resource version is managed by the database'
      USING ERRCODE = '40001';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION core.reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION core.assert_resource_version(actual bigint, expected bigint)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
BEGIN
  IF actual <> expected THEN
    RAISE EXCEPTION 'resource version conflict: expected %, actual %', expected, actual
      USING ERRCODE = '40001';
  END IF;
END;
$$;

REVOKE ALL ON SCHEMA core FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA core FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA core REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
