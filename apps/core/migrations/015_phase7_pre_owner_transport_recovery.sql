-- ALICA Hermes Phase 7 forward repair: reconcile a proven pre-owner transport failure.
-- The provisional dispatch lease is returned only after exact owner-state reconciliation.

CREATE OR REPLACE FUNCTION core.recover_phase7_pre_owner_transport_failure(
  reservation_value text,
  owner_source_value text,
  terminal_digest_value bytea,
  freshness_seconds integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  reservation core.framework_command_canary_reservations%ROWTYPE;
  policy core.framework_command_canary_policies%ROWTYPE;
  terminal_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO reservation FROM core.framework_command_canary_reservations
    WHERE reservation_id=reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state <> 'dispatching'
     OR reservation.canonical_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'P7_TRANSPORT_RESERVATION_NOT_RECOVERABLE' USING ERRCODE = 'P7017';
  END IF;
  SELECT * INTO policy FROM core.framework_command_canary_policies
    WHERE canary_policy_id=reservation.canary_policy_id FOR UPDATE;
  IF policy.enabled OR policy.circuit_state <> 'open' OR policy.dispatch_count <> 1
     OR policy.failure_count <> 0 OR policy.disabled_at IS NOT NULL
     OR owner_source_value <> policy.baseline_source_version THEN
    RAISE EXCEPTION 'P7_TRANSPORT_POLICY_NOT_RECOVERABLE' USING ERRCODE = 'P7018';
  END IF;
  IF freshness_seconds < 60 OR freshness_seconds > 1800 THEN
    RAISE EXCEPTION 'P7_INVALID_FRESHNESS' USING ERRCODE = 'P7016';
  END IF;

  UPDATE core.framework_command_canary_reservations
    SET state='failed',terminal_at=terminal_time,
        owner_source_version=owner_source_value,
        terminal_evidence_digest=terminal_digest_value,
        safe_error_code='P7_ADAPTER_CONNECTION_TERMINATED'
    WHERE reservation_id=reservation_value;
  UPDATE core.operations
    SET status='failed',finished_at=terminal_time,
        error=jsonb_build_object('code','P7_ADAPTER_CONNECTION_TERMINATED',
          'ownerDispatchCount',0,'ownerStateReconciled',true)
    WHERE id=reservation.predecessor_operation_id;
  INSERT INTO core.framework_command_canary_faults
    (fault_id,canary_policy_id,fault_class,expected_result,
     owner_dispatch_count,evidence_digest,safe_code)
  VALUES
    (core.generate_alica_id('flt'),policy.canary_policy_id,'timeout','failed-before-owner',
     0,terminal_digest_value,'P7_ADAPTER_CONNECTION_TERMINATED');
  UPDATE core.framework_command_canary_policies
    SET dispatch_count=dispatch_count-1,failure_count=failure_count+1,
        enabled=true,circuit_state='closed',
        fresh_until=clock_timestamp()+make_interval(secs=>freshness_seconds)
    WHERE canary_policy_id=policy.canary_policy_id;
END
$$;

REVOKE EXECUTE ON FUNCTION core.recover_phase7_pre_owner_transport_failure(text,text,bytea,integer) FROM PUBLIC;
