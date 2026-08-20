-- ALICA Hermes Phase 7 forward repair: reconcile owner-completed delete after
-- the bounded client timed out while the owner finished removing the canary.

CREATE OR REPLACE FUNCTION core.reconcile_phase7_post_owner_delete(
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
  create_source text;
BEGIN
  SELECT * INTO reservation FROM core.framework_command_canary_reservations
    WHERE reservation_id=reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state <> 'dispatching'
     OR reservation.operation <> 'profile.delete'
     OR reservation.canonical_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'P7_POST_OWNER_DELETE_NOT_RECONCILABLE' USING ERRCODE = 'P7021';
  END IF;
  SELECT * INTO policy FROM core.framework_command_canary_policies
    WHERE canary_policy_id=reservation.canary_policy_id FOR UPDATE;
  SELECT owner_source_version INTO create_source
    FROM core.framework_command_canary_reservations
    WHERE canary_policy_id=reservation.canary_policy_id
      AND operation='profile.create' AND state='completed'
    ORDER BY terminal_at DESC LIMIT 1;
  IF policy.enabled OR policy.circuit_state <> 'open'
     OR policy.dispatch_count <> policy.dispatch_limit
     OR policy.failure_count <> 1 OR policy.disabled_at IS NOT NULL
     OR create_source IS NULL OR owner_source_value = create_source THEN
    RAISE EXCEPTION 'P7_POST_OWNER_DELETE_POLICY_NOT_RECONCILABLE' USING ERRCODE = 'P7022';
  END IF;
  IF freshness_seconds < 60 OR freshness_seconds > 1800 THEN
    RAISE EXCEPTION 'P7_INVALID_FRESHNESS' USING ERRCODE = 'P7016';
  END IF;

  PERFORM core.complete_phase7_canary_dispatch(
    reservation_value,
    'reconciled:P7_BOUNDED_DELETE_TIMEOUT',
    owner_source_value,
    terminal_digest_value
  );
  UPDATE core.framework_command_canary_policies
    SET enabled=true,circuit_state='closed',
        fresh_until=clock_timestamp()+make_interval(secs=>freshness_seconds)
    WHERE canary_policy_id=policy.canary_policy_id;
END
$$;

REVOKE EXECUTE ON FUNCTION core.reconcile_phase7_post_owner_delete(text,text,bytea,integer) FROM PUBLIC;
