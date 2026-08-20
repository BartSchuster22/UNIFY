-- ALICA Hermes Phase 7 forward repair: preserve immutable canonical evidence.
-- Canonical framework operation rows are now inserted once, at terminal completion.

ALTER TABLE core.framework_command_canary_reservations
  ALTER COLUMN canonical_operation_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION core.guard_phase7_canary_reservation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.reservation_id, NEW.canary_policy_id, NEW.predecessor_operation_id,
    NEW.command_id, NEW.operation, NEW.mode, NEW.idempotency_key,
    NEW.request_digest, NEW.expected_source_version, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.reservation_id, OLD.canary_policy_id, OLD.predecessor_operation_id,
    OLD.command_id, OLD.operation, OLD.mode, OLD.idempotency_key,
    OLD.request_digest, OLD.expected_source_version, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Phase 7 canary reservation identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.canonical_operation_id IS NOT NULL
     AND NEW.canonical_operation_id IS DISTINCT FROM OLD.canonical_operation_id THEN
    RAISE EXCEPTION 'Phase 7 canonical operation binding is immutable once set' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION core.reserve_phase7_canary_command(
  policy_value text,
  controller_value text,
  principal_value text,
  tenant_value text,
  client_value text,
  application_value text,
  framework_value text,
  context_profile_value text,
  target_profile_value text,
  native_target_value text,
  operation_value text,
  idempotency_value text,
  request_digest_value bytea,
  expected_source_value text
)
RETURNS TABLE(reservation_id text, state text, replayed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  policy core.framework_command_canary_policies%ROWTYPE;
  existing core.framework_command_canary_reservations%ROWTYPE;
  predecessor_id text;
  command_value text;
  reservation_value text;
BEGIN
  SELECT * INTO policy FROM core.framework_command_canary_policies
  WHERE canary_policy_id = policy_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P7_POLICY_NOT_FOUND' USING ERRCODE = 'P7001'; END IF;
  IF NOT policy.enabled OR policy.circuit_state <> 'closed' THEN
    RAISE EXCEPTION 'P7_POLICY_DISABLED_OR_OPEN' USING ERRCODE = 'P7002';
  END IF;
  IF policy.fresh_until < clock_timestamp() THEN
    RAISE EXCEPTION 'P7_POLICY_STALE' USING ERRCODE = 'P7003';
  END IF;
  IF ROW(controller_value, principal_value, tenant_value, client_value, application_value,
         framework_value, context_profile_value, target_profile_value, native_target_value)
     IS DISTINCT FROM ROW(policy.controller_service_principal_id, policy.canonical_principal_id,
         policy.tenant_id, policy.client_id, policy.application_id, policy.framework_id,
         policy.context_agent_profile_id, policy.target_agent_profile_id, policy.native_target_id) THEN
    RAISE EXCEPTION 'P7_PROVENANCE_MISMATCH' USING ERRCODE = 'P7004';
  END IF;
  IF NOT operation_value = ANY(policy.allowed_operations) THEN
    RAISE EXCEPTION 'P7_OPERATION_FORBIDDEN' USING ERRCODE = 'P7005';
  END IF;
  IF operation_value = 'profile.create' AND expected_source_value <> policy.baseline_source_version THEN
    RAISE EXCEPTION 'P7_SOURCE_VERSION_MISMATCH' USING ERRCODE = 'P7006';
  END IF;
  IF operation_value = 'profile.delete' AND NOT EXISTS (
    SELECT 1 FROM core.framework_command_canary_reservations r
    WHERE r.canary_policy_id = policy_value AND r.operation = 'profile.create' AND r.state = 'completed'
  ) THEN
    RAISE EXCEPTION 'P7_CREATE_NOT_COMPLETED' USING ERRCODE = 'P7007';
  END IF;

  SELECT * INTO existing FROM core.framework_command_canary_reservations r
  WHERE r.canary_policy_id = policy_value AND r.idempotency_key = idempotency_value;
  IF FOUND THEN
    IF existing.request_digest <> request_digest_value OR existing.operation <> operation_value THEN
      RAISE EXCEPTION 'P7_IDEMPOTENCY_CONFLICT' USING ERRCODE = 'P7008';
    END IF;
    RETURN QUERY SELECT existing.reservation_id, existing.state, true;
    RETURN;
  END IF;

  predecessor_id := core.generate_alica_id('opc');
  command_value := core.generate_alica_id('cmd');
  reservation_value := core.generate_alica_id('rsv');

  INSERT INTO core.operations
    (id, command_id, command_type, actor_kind, actor_id, target_kind, target_id,
     idempotency_key, payload_digest, payload, status)
  VALUES
    (predecessor_id, command_value, 'hermes.profile-canary.v1', 'service', controller_value,
     'framework', framework_value, idempotency_value, request_digest_value,
     jsonb_build_object('operation', operation_value, 'nativeTargetId', native_target_value,
       'tenantId', tenant_value, 'clientId', client_value, 'applicationId', application_value,
       'contextAgentProfileId', context_profile_value, 'targetAgentProfileId', target_profile_value),
     'accepted');

  INSERT INTO core.framework_command_canary_reservations
    (reservation_id, canary_policy_id, predecessor_operation_id, canonical_operation_id,
     command_id, operation, mode, idempotency_key, request_digest,
     expected_source_version, state)
  VALUES
    (reservation_value, policy_value, predecessor_id, NULL, command_value,
     operation_value, 'execute', idempotency_value, request_digest_value,
     expected_source_value, 'reserved');

  RETURN QUERY SELECT reservation_value, 'reserved'::text, false;
END
$$;

CREATE OR REPLACE FUNCTION core.start_phase7_canary_dispatch(reservation_value text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  reservation core.framework_command_canary_reservations%ROWTYPE;
  policy core.framework_command_canary_policies%ROWTYPE;
BEGIN
  SELECT * INTO reservation FROM core.framework_command_canary_reservations
  WHERE reservation_id = reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state <> 'reserved' THEN
    RAISE EXCEPTION 'P7_RESERVATION_NOT_DISPATCHABLE' USING ERRCODE = 'P7010';
  END IF;
  SELECT * INTO policy FROM core.framework_command_canary_policies
  WHERE canary_policy_id = reservation.canary_policy_id FOR UPDATE;
  IF NOT policy.enabled OR policy.circuit_state <> 'closed' OR policy.fresh_until < clock_timestamp() THEN
    RAISE EXCEPTION 'P7_POLICY_NOT_DISPATCHABLE' USING ERRCODE = 'P7011';
  END IF;
  IF policy.dispatch_count >= policy.dispatch_limit THEN
    RAISE EXCEPTION 'P7_DISPATCH_LIMIT' USING ERRCODE = 'P7012';
  END IF;
  UPDATE core.framework_command_canary_policies
    SET dispatch_count = dispatch_count + 1 WHERE canary_policy_id = policy.canary_policy_id;
  UPDATE core.framework_command_canary_reservations
    SET state='dispatching', dispatch_started_at=clock_timestamp()
    WHERE reservation_id = reservation_value;
  UPDATE core.operations SET status='running', started_at=clock_timestamp(), attempt_count=1
    WHERE id = reservation.predecessor_operation_id;
END
$$;

CREATE OR REPLACE FUNCTION core.complete_phase7_canary_dispatch(
  reservation_value text,
  adapter_operation_value text,
  owner_source_value text,
  terminal_digest_value bytea
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  reservation core.framework_command_canary_reservations%ROWTYPE;
  policy core.framework_command_canary_policies%ROWTYPE;
  predecessor core.operations%ROWTYPE;
  terminal_time timestamptz := clock_timestamp();
  canonical_value text := core.generate_alica_id('op');
BEGIN
  SELECT * INTO reservation FROM core.framework_command_canary_reservations
  WHERE reservation_id = reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state <> 'dispatching' OR reservation.canonical_operation_id IS NOT NULL THEN
    RAISE EXCEPTION 'P7_RESERVATION_NOT_COMPLETABLE' USING ERRCODE = 'P7013';
  END IF;
  SELECT * INTO policy FROM core.framework_command_canary_policies
  WHERE canary_policy_id = reservation.canary_policy_id;
  SELECT * INTO predecessor FROM core.operations WHERE id = reservation.predecessor_operation_id;

  UPDATE core.operations
    SET status='succeeded', finished_at=terminal_time,
        result=jsonb_build_object('terminalOwnerVerified', true,
          'ownerSourceVersion', owner_source_value,
          'terminalEvidenceDigest', encode(terminal_digest_value,'hex'))
    WHERE id = reservation.predecessor_operation_id;

  INSERT INTO core.framework_operations
    (operation_id, predecessor_operation_id, framework_id, agent_profile_id, command_id,
     actor_predecessor_reference, principal_id, tenant_id, client_id, capability_key,
     mode, idempotency_key, request_digest, authorization_state, state,
     retention_policy_key, requested_at, terminal_at)
  VALUES
    (canonical_value, reservation.predecessor_operation_id, policy.framework_id,
     policy.context_agent_profile_id, reservation.command_id,
     'service:' || policy.controller_service_principal_id, policy.canonical_principal_id,
     policy.tenant_id, policy.client_id, policy.owner_capability, 'execute',
     reservation.idempotency_key, reservation.request_digest, 'authorized', 'completed',
     'phase7-canary-evidence/v1', predecessor.accepted_at, terminal_time);

  INSERT INTO core.framework_native_aliases
    (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace,
     alias_value, alias_kind, source_reference)
  VALUES
    (policy.framework_id, 'operation', canonical_value, 'phase7.canary-reservation',
     reservation.reservation_id, 'native-resource',
     'core.framework_command_canary_reservations');

  INSERT INTO core.framework_executions
    (agent_execution_id, framework_id, agent_profile_id, operation_id,
     native_execution_alias, source_version, state, observed_at, payload_digest)
  VALUES
    (core.generate_alica_id('aex'), policy.framework_id, policy.context_agent_profile_id,
     canonical_value, 'phase7:' || reservation.reservation_id,
     owner_source_value, 'succeeded', terminal_time, terminal_digest_value);

  UPDATE core.framework_command_canary_reservations
    SET canonical_operation_id=canonical_value, state='completed', terminal_at=terminal_time,
        adapter_operation_id=adapter_operation_value, owner_source_version=owner_source_value,
        terminal_evidence_digest=terminal_digest_value
    WHERE reservation_id = reservation_value;
END
$$;

CREATE OR REPLACE FUNCTION core.cancel_phase7_canary_reservation(
  reservation_value text,
  safe_code_value text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  reservation core.framework_command_canary_reservations%ROWTYPE;
  terminal_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO reservation FROM core.framework_command_canary_reservations
    WHERE reservation_id=reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state <> 'reserved' THEN
    RAISE EXCEPTION 'P7_RESERVATION_NOT_CANCELLABLE' USING ERRCODE = 'P7014';
  END IF;
  UPDATE core.framework_command_canary_reservations
    SET state='cancelled', terminal_at=terminal_time, safe_error_code=safe_code_value
    WHERE reservation_id=reservation_value;
  UPDATE core.operations SET status='cancelled', finished_at=terminal_time,
      error=jsonb_build_object('code',safe_code_value,'ownerDispatchCount',0)
    WHERE id=reservation.predecessor_operation_id;
END
$$;

CREATE OR REPLACE FUNCTION core.rearm_phase7_canary(
  policy_value text,
  freshness_seconds integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  policy core.framework_command_canary_policies%ROWTYPE;
BEGIN
  SELECT * INTO policy FROM core.framework_command_canary_policies
    WHERE canary_policy_id=policy_value FOR UPDATE;
  IF NOT FOUND OR policy.enabled OR policy.circuit_state <> 'open'
     OR policy.dispatch_count <> 0 OR policy.failure_count <> 0 OR policy.disabled_at IS NOT NULL THEN
    RAISE EXCEPTION 'P7_POLICY_NOT_REARMABLE' USING ERRCODE = 'P7015';
  END IF;
  IF freshness_seconds < 60 OR freshness_seconds > 1800 THEN
    RAISE EXCEPTION 'P7_INVALID_FRESHNESS' USING ERRCODE = 'P7016';
  END IF;
  UPDATE core.framework_command_canary_policies
    SET enabled=true,circuit_state='closed',fresh_until=clock_timestamp()+make_interval(secs=>freshness_seconds)
    WHERE canary_policy_id=policy_value;
END
$$;

REVOKE EXECUTE ON FUNCTION core.cancel_phase7_canary_reservation(text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.rearm_phase7_canary(text,integer) FROM PUBLIC;
