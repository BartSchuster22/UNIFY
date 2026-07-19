ALTER TABLE operations
  ADD COLUMN result jsonb,
  ADD COLUMN error jsonb,
  ADD CONSTRAINT operations_state_check CHECK (state IN ('pending','validated','preflighted','awaiting_confirmation','executing','applied','verifying','verified','denied','failed','inconclusive','rolling_back','rolled_back','rollback_failed'));

ALTER TABLE evidence_references ADD COLUMN redacted_payload jsonb;

CREATE OR REPLACE FUNCTION reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER operation_transitions_immutable BEFORE UPDATE OR DELETE ON operation_transitions
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER evidence_references_immutable BEFORE UPDATE OR DELETE ON evidence_references
FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE INDEX idempotency_records_expiry_idx ON idempotency_records(expires_at);
CREATE INDEX evidence_references_operation_idx ON evidence_references(operation_id, created_at);
