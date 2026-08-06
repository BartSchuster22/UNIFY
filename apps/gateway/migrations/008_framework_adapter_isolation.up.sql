-- Enforce framework tenancy at the database boundary for the two Hermes adapter login roles.
-- The owning Core role remains able to read the combined derived-event journal.
REVOKE UPDATE, DELETE ON hermes_adapter_events, hermes_adapter_audit
FROM unify_hermes_adapter_runtime;

ALTER TABLE hermes_adapter_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_adapter_idempotency ENABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_adapter_audit ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION hermes_adapter_framework_for_session()
RETURNS text
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE session_user
    WHEN 'unify_alica_adapter' THEN 'hermes-alica'
    WHEN 'unify_herman_adapter' THEN 'hermes-herman'
    ELSE NULL
  END
$$;

CREATE POLICY hermes_adapter_events_tenant
ON hermes_adapter_events
TO unify_hermes_adapter_runtime
USING (framework_id = hermes_adapter_framework_for_session())
WITH CHECK (framework_id = hermes_adapter_framework_for_session());

CREATE POLICY hermes_adapter_idempotency_tenant
ON hermes_adapter_idempotency
TO unify_hermes_adapter_runtime
USING (framework_id = hermes_adapter_framework_for_session())
WITH CHECK (framework_id = hermes_adapter_framework_for_session());

CREATE POLICY hermes_adapter_audit_tenant
ON hermes_adapter_audit
TO unify_hermes_adapter_runtime
USING (framework_id = hermes_adapter_framework_for_session())
WITH CHECK (framework_id = hermes_adapter_framework_for_session());

CREATE FUNCTION reject_hermes_adapter_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'hermes_adapter_audit is append-only';
END
$$;

CREATE TRIGGER hermes_adapter_audit_immutable
BEFORE UPDATE OR DELETE ON hermes_adapter_audit
FOR EACH ROW EXECUTE FUNCTION reject_hermes_adapter_audit_mutation();
