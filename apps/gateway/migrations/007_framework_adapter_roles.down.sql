REVOKE unify_hermes_adapter_runtime FROM unify_alica_adapter, unify_herman_adapter;
REVOKE ALL PRIVILEGES ON
  hermes_adapter_events,
  hermes_adapter_idempotency,
  hermes_adapter_audit
FROM unify_hermes_adapter_runtime;
REVOKE ALL PRIVILEGES ON
  hermes_adapter_events_sequence_seq,
  hermes_adapter_audit_sequence_seq
FROM unify_hermes_adapter_runtime;
REVOKE USAGE ON SCHEMA public FROM unify_hermes_adapter_runtime;

DO $database_revoke$
BEGIN
  EXECUTE format(
    'REVOKE CONNECT ON DATABASE %I FROM unify_hermes_adapter_runtime',
    current_database()
  );
END
$database_revoke$;

DROP ROLE IF EXISTS unify_alica_adapter;
DROP ROLE IF EXISTS unify_herman_adapter;
DROP ROLE IF EXISTS unify_hermes_adapter_runtime;
