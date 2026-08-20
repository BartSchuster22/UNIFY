-- ALICA Hermes Phase 7 forward repair: reconcile owner-completed create after
-- the adapter's fixed-width profile-list parser rejected the terminal row.

CREATE OR REPLACE FUNCTION core.reconcile_phase7_post_owner_create(
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
BEGIN
  SELECT * INTO reservation FROM core.framework_command_canary_reservations
    WHERE reservation_id=reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state <> 'dispatching'
     OR reservation.operation <> 'profile.create'
     OR reservation.canonical_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'P7_POST_OWNER_CREATE_NOT_RECONCILABLE' USING ERRCODE = 'P7019';
  END IF;
  SELECT * INTO policy FROM core.framework_command_canary_policies
    WHERE canary_policy_id=reservation.canary_policy_id FOR UPDATE;
  IF policy.enabled OR policy.circuit_state <> 'open' OR policy.dispatch_count <> 1
     OR policy.failure_count <> 1 OR policy.disabled_at IS NOT NULL
     OR owner_source_value = policy.baseline_source_version THEN
    RAISE EXCEPTION 'P7_POST_OWNER_POLICY_NOT_RECONCILABLE' USING ERRCODE = 'P7020';
  END IF;
  IF freshness_seconds < 60 OR freshness_seconds > 1800 THEN
    RAISE EXCEPTION 'P7_INVALID_FRESHNESS' USING ERRCODE = 'P7016';
  END IF;

  PERFORM core.complete_phase7_canary_dispatch(
    reservation_value,
    'reconciled:P7_PROFILE_LIST_WIDTH_PARSER',
    owner_source_value,
    terminal_digest_value
  );
  UPDATE core.framework_command_canary_policies
    SET enabled=true,circuit_state='closed',
        fresh_until=clock_timestamp()+make_interval(secs=>freshness_seconds)
    WHERE canary_policy_id=policy.canary_policy_id;
END
$$;

REVOKE EXECUTE ON FUNCTION core.reconcile_phase7_post_owner_create(text,text,bytea,integer) FROM PUBLIC;
