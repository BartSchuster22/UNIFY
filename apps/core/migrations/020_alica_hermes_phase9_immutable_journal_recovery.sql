-- ALICA Hermes Phase 9 recovery: framework_operations is an immutable authorization journal.
-- Runtime progress and terminal evidence belong to capability reservations and executions.

CREATE OR REPLACE FUNCTION core.start_phase9_capability_dispatch(reservation_value text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE reservation core.framework_capability_canary_reservations%ROWTYPE;
  policy core.framework_capability_canary_policies%ROWTYPE;
BEGIN
  SELECT * INTO reservation FROM core.framework_capability_canary_reservations
    WHERE reservation_id=reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state<>'reserved' OR reservation.mode<>'execute' THEN
    RAISE EXCEPTION 'P9_RESERVATION_NOT_DISPATCHABLE' USING ERRCODE='P9010';
  END IF;
  SELECT * INTO policy FROM core.framework_capability_canary_policies
    WHERE policy_id=reservation.policy_id FOR UPDATE;
  IF NOT policy.enabled OR NOT policy.execute_enabled OR policy.circuit_state<>'closed'
      OR policy.fresh_until<clock_timestamp() OR policy.dispatch_count>=policy.dispatch_limit THEN
    RAISE EXCEPTION 'P9_POLICY_NOT_DISPATCHABLE' USING ERRCODE='P9011';
  END IF;
  UPDATE core.framework_capability_canary_policies SET dispatch_count=dispatch_count+1
    WHERE policy_id=policy.policy_id;
  UPDATE core.framework_capability_canary_reservations SET state='dispatching',
    dispatch_started_at=clock_timestamp() WHERE reservation_id=reservation_value;
  UPDATE core.operations SET status='running',started_at=clock_timestamp(),attempt_count=1
    WHERE id=reservation.predecessor_operation_id;
END $$;

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
  UPDATE core.operations SET status='succeeded',started_at=coalesce(started_at,created_at),
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

REVOKE EXECUTE ON FUNCTION core.start_phase9_capability_dispatch(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.complete_phase9_capability_command(text,text,text,bytea) FROM PUBLIC;
