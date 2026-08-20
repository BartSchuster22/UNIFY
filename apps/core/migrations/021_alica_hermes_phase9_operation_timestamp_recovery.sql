-- ALICA Hermes Phase 9 recovery: core.operations start fallback is accepted_at.

CREATE OR REPLACE FUNCTION core.complete_phase9_capability_command(
  reservation_value text, adapter_operation_value text,
  owner_source_value text, terminal_digest_value bytea)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE reservation core.framework_capability_canary_reservations%ROWTYPE;
  policy core.framework_capability_canary_policies%ROWTYPE;
  terminal_time timestamptz:=clock_timestamp();
BEGIN
  SELECT * INTO reservation FROM core.framework_capability_canary_reservations
    WHERE reservation_id=reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state NOT IN ('reserved','dispatching') THEN
    RAISE EXCEPTION 'P9_RESERVATION_NOT_COMPLETABLE' USING ERRCODE='P9012';
  END IF;
  IF reservation.mode='execute' AND reservation.state<>'dispatching' THEN
    RAISE EXCEPTION 'P9_EXECUTE_NOT_DISPATCHED' USING ERRCODE='P9013';
  END IF;
  SELECT * INTO policy FROM core.framework_capability_canary_policies WHERE policy_id=reservation.policy_id;
  UPDATE core.framework_capability_canary_reservations SET state='completed',terminal_at=terminal_time,
    adapter_operation_id=adapter_operation_value,owner_source_version=owner_source_value,
    terminal_evidence_digest=terminal_digest_value WHERE reservation_id=reservation_value;
  UPDATE core.operations SET status='succeeded',started_at=coalesce(started_at,accepted_at),
    finished_at=terminal_time,result=jsonb_build_object('terminalOwnerVerified',true,
      'ownerSourceVersion',owner_source_value,'terminalEvidenceDigest',encode(terminal_digest_value,'hex'))
    WHERE id=reservation.predecessor_operation_id;
  IF reservation.mode='execute' THEN
    INSERT INTO core.framework_executions(agent_execution_id,framework_id,agent_profile_id,
      operation_id,native_execution_alias,source_version,state,observed_at,payload_digest)
    VALUES(core.generate_alica_id('aex'),policy.framework_id,policy.context_agent_profile_id,
      reservation.canonical_operation_id,'phase9:'||reservation.reservation_id,
      owner_source_value,'succeeded',terminal_time,terminal_digest_value);
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION core.complete_phase9_capability_command(text,text,text,bytea) FROM PUBLIC;
