DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unify_hermes_adapter_runtime') THEN
    CREATE ROLE unify_hermes_adapter_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unify_alica_adapter') THEN
    CREATE ROLE unify_alica_adapter NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unify_herman_adapter') THEN
    CREATE ROLE unify_herman_adapter NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
  END IF;
END
$roles$;

GRANT unify_hermes_adapter_runtime TO unify_alica_adapter, unify_herman_adapter;
GRANT USAGE ON SCHEMA public TO unify_hermes_adapter_runtime;
GRANT SELECT, INSERT, UPDATE ON
  hermes_adapter_events,
  hermes_adapter_idempotency,
  hermes_adapter_audit
TO unify_hermes_adapter_runtime;
GRANT USAGE, SELECT ON
  hermes_adapter_events_sequence_seq,
  hermes_adapter_audit_sequence_seq
TO unify_hermes_adapter_runtime;

DO $database_grant$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO unify_hermes_adapter_runtime',
    current_database()
  );
END
$database_grant$;
