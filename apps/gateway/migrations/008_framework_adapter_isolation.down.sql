DROP TRIGGER IF EXISTS hermes_adapter_audit_immutable ON hermes_adapter_audit;
DROP FUNCTION IF EXISTS reject_hermes_adapter_audit_mutation();

DROP POLICY IF EXISTS hermes_adapter_audit_tenant ON hermes_adapter_audit;
DROP POLICY IF EXISTS hermes_adapter_idempotency_tenant ON hermes_adapter_idempotency;
DROP POLICY IF EXISTS hermes_adapter_events_tenant ON hermes_adapter_events;

ALTER TABLE hermes_adapter_audit DISABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_adapter_idempotency DISABLE ROW LEVEL SECURITY;
ALTER TABLE hermes_adapter_events DISABLE ROW LEVEL SECURITY;

DROP FUNCTION IF EXISTS hermes_adapter_framework_for_session();

GRANT UPDATE ON hermes_adapter_events, hermes_adapter_audit
TO unify_hermes_adapter_runtime;
