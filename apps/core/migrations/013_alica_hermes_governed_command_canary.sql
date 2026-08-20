-- ALICA Hermes Phase 7: exact-scope governed command canary controls.
-- This migration creates disabled-by-default control structures. It does not seed or enable a policy.

CREATE TABLE core.framework_command_canary_policies (
  canary_policy_id text PRIMARY KEY CHECK (core.is_canonical_id(canary_policy_id, 'cny')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  context_agent_profile_id text NOT NULL REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  target_agent_profile_id text NOT NULL CHECK (core.is_canonical_id(target_agent_profile_id, 'agp')),
  controller_service_principal_id text NOT NULL REFERENCES core.service_principals(id) ON DELETE RESTRICT,
  canonical_principal_id text NOT NULL CHECK (core.is_canonical_id(canonical_principal_id, 'prn')),
  tenant_id text NOT NULL CHECK (core.is_canonical_id(tenant_id, 'ten')),
  client_id text NOT NULL CHECK (core.is_canonical_id(client_id, 'cli')),
  application_id text NOT NULL CHECK (core.is_canonical_id(application_id, 'app')),
  native_target_id text NOT NULL CHECK (native_target_id ~ '^[a-z0-9][a-z0-9_-]{0,127}$'),
  operation_family text NOT NULL CHECK (operation_family = 'profile-lifecycle'),
  allowed_operations text[] NOT NULL CHECK (
    allowed_operations = ARRAY['profile.create','profile.delete']::text[]
  ),
  owner_capability text NOT NULL CHECK (owner_capability = 'profiles.execute'),
  approval_reference text NOT NULL CHECK (length(approval_reference) BETWEEN 1 AND 500),
  baseline_source_version text NOT NULL CHECK (length(baseline_source_version) BETWEEN 1 AND 256),
  expected_owner_profile_count integer NOT NULL CHECK (expected_owner_profile_count >= 1),
  dispatch_limit integer NOT NULL DEFAULT 2 CHECK (dispatch_limit = 2),
  dispatch_count integer NOT NULL DEFAULT 0 CHECK (dispatch_count BETWEEN 0 AND dispatch_limit),
  failure_threshold integer NOT NULL DEFAULT 2 CHECK (failure_threshold = 2),
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  circuit_state text NOT NULL DEFAULT 'closed' CHECK (circuit_state IN ('closed','open','disabled')),
  enabled boolean NOT NULL DEFAULT false,
  fresh_until timestamptz NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  disabled_at timestamptz,
  CHECK (fresh_until > created_at),
  CHECK (NOT enabled OR (circuit_state = 'closed' AND disabled_at IS NULL)),
  CHECK (disabled_at IS NULL OR (NOT enabled AND circuit_state = 'disabled')),
  UNIQUE (framework_id, native_target_id),
  UNIQUE (target_agent_profile_id)
);

CREATE OR REPLACE FUNCTION core.guard_phase7_canary_policy_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.canary_policy_id, NEW.framework_id, NEW.context_agent_profile_id,
    NEW.target_agent_profile_id, NEW.controller_service_principal_id,
    NEW.canonical_principal_id, NEW.tenant_id, NEW.client_id, NEW.application_id,
    NEW.native_target_id, NEW.operation_family, NEW.allowed_operations,
    NEW.owner_capability, NEW.approval_reference, NEW.baseline_source_version,
    NEW.expected_owner_profile_count, NEW.dispatch_limit, NEW.failure_threshold,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.canary_policy_id, OLD.framework_id, OLD.context_agent_profile_id,
    OLD.target_agent_profile_id, OLD.controller_service_principal_id,
    OLD.canonical_principal_id, OLD.tenant_id, OLD.client_id, OLD.application_id,
    OLD.native_target_id, OLD.operation_family, OLD.allowed_operations,
    OLD.owner_capability, OLD.approval_reference, OLD.baseline_source_version,
    OLD.expected_owner_profile_count, OLD.dispatch_limit, OLD.failure_threshold,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Phase 7 canary policy scope is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Phase 7 canary policy version is database-managed' USING ERRCODE = '40001';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER framework_command_canary_policies_guard
BEFORE UPDATE ON core.framework_command_canary_policies
FOR EACH ROW EXECUTE FUNCTION core.guard_phase7_canary_policy_update();
CREATE TRIGGER framework_command_canary_policies_no_delete
BEFORE DELETE ON core.framework_command_canary_policies
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_command_canary_reservations (
  reservation_id text PRIMARY KEY CHECK (core.is_canonical_id(reservation_id, 'rsv')),
  canary_policy_id text NOT NULL REFERENCES core.framework_command_canary_policies(canary_policy_id) ON DELETE RESTRICT,
  predecessor_operation_id text NOT NULL UNIQUE REFERENCES core.operations(id) ON DELETE RESTRICT,
  canonical_operation_id text NOT NULL UNIQUE REFERENCES core.framework_operations(operation_id) ON DELETE RESTRICT,
  command_id text NOT NULL UNIQUE CHECK (core.is_canonical_id(command_id, 'cmd')),
  operation text NOT NULL CHECK (operation IN ('profile.create','profile.delete')),
  mode text NOT NULL CHECK (mode = 'execute'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'),
  request_digest bytea NOT NULL CHECK (octet_length(request_digest) = 32),
  expected_source_version text NOT NULL CHECK (length(expected_source_version) BETWEEN 1 AND 256),
  owner_source_version text,
  state text NOT NULL CHECK (state IN ('reserved','dispatching','completed','failed','inconclusive','cancelled')),
  dispatch_started_at timestamptz,
  terminal_at timestamptz,
  adapter_operation_id text,
  terminal_evidence_digest bytea CHECK (terminal_evidence_digest IS NULL OR octet_length(terminal_evidence_digest) = 32),
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (canary_policy_id, idempotency_key),
  CHECK ((state = 'reserved' AND dispatch_started_at IS NULL AND terminal_at IS NULL)
    OR (state = 'dispatching' AND dispatch_started_at IS NOT NULL AND terminal_at IS NULL)
    OR (state IN ('completed','failed','inconclusive','cancelled') AND terminal_at IS NOT NULL)),
  CHECK (terminal_at IS NULL OR terminal_at >= created_at)
);

CREATE OR REPLACE FUNCTION core.guard_phase7_canary_reservation_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.reservation_id, NEW.canary_policy_id, NEW.predecessor_operation_id,
    NEW.canonical_operation_id, NEW.command_id, NEW.operation, NEW.mode,
    NEW.idempotency_key, NEW.request_digest, NEW.expected_source_version, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.reservation_id, OLD.canary_policy_id, OLD.predecessor_operation_id,
    OLD.canonical_operation_id, OLD.command_id, OLD.operation, OLD.mode,
    OLD.idempotency_key, OLD.request_digest, OLD.expected_source_version, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Phase 7 canary reservation identity is immutable' USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER framework_command_canary_reservations_guard
BEFORE UPDATE ON core.framework_command_canary_reservations
FOR EACH ROW EXECUTE FUNCTION core.guard_phase7_canary_reservation_update();
CREATE TRIGGER framework_command_canary_reservations_no_delete
BEFORE DELETE ON core.framework_command_canary_reservations
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.framework_command_canary_faults (
  fault_id text PRIMARY KEY CHECK (core.is_canonical_id(fault_id, 'flt')),
  canary_policy_id text NOT NULL REFERENCES core.framework_command_canary_policies(canary_policy_id) ON DELETE RESTRICT,
  fault_class text NOT NULL CHECK (fault_class IN ('timeout','duplicate','provenance','circuit-open')),
  expected_result text NOT NULL CHECK (expected_result IN ('failed-before-owner','replayed-without-owner','denied-before-owner','circuit-opened','blocked-before-owner')),
  owner_dispatch_count integer NOT NULL CHECK (owner_dispatch_count = 0),
  evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest) = 32),
  safe_code text NOT NULL CHECK (safe_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER framework_command_canary_faults_immutable
BEFORE UPDATE OR DELETE ON core.framework_command_canary_faults
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

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
  canonical_id text;
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
  canonical_id := core.generate_alica_id('op');
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

  INSERT INTO core.framework_operations
    (operation_id, predecessor_operation_id, framework_id, agent_profile_id, command_id,
     actor_predecessor_reference, principal_id, tenant_id, client_id, capability_key,
     mode, idempotency_key, request_digest, authorization_state, state,
     retention_policy_key, requested_at)
  VALUES
    (canonical_id, predecessor_id, framework_value, context_profile_value, command_value,
     'service:' || controller_value, principal_value, tenant_value, client_value,
     policy.owner_capability, 'execute', idempotency_value, request_digest_value,
     'authorized', 'authorized', 'phase7-canary-evidence/v1', clock_timestamp());

  INSERT INTO core.framework_command_canary_reservations
    (reservation_id, canary_policy_id, predecessor_operation_id, canonical_operation_id,
     command_id, operation, mode, idempotency_key, request_digest,
     expected_source_version, state)
  VALUES
    (reservation_value, policy_value, predecessor_id, canonical_id, command_value,
     operation_value, 'execute', idempotency_value, request_digest_value,
     expected_source_value, 'reserved');

  INSERT INTO core.framework_native_aliases
    (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace,
     alias_value, alias_kind, source_reference)
  VALUES
    (framework_value, 'operation', canonical_id, 'phase7.canary-reservation',
     reservation_value, 'native-resource', 'core.framework_command_canary_reservations');

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
  UPDATE core.framework_operations SET state='dispatched'
    WHERE operation_id = reservation.canonical_operation_id;
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
  terminal_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO reservation FROM core.framework_command_canary_reservations
  WHERE reservation_id = reservation_value FOR UPDATE;
  IF NOT FOUND OR reservation.state <> 'dispatching' THEN
    RAISE EXCEPTION 'P7_RESERVATION_NOT_COMPLETABLE' USING ERRCODE = 'P7013';
  END IF;
  SELECT * INTO policy FROM core.framework_command_canary_policies
  WHERE canary_policy_id = reservation.canary_policy_id;
  UPDATE core.framework_command_canary_reservations
    SET state='completed', terminal_at=terminal_time, adapter_operation_id=adapter_operation_value,
        owner_source_version=owner_source_value, terminal_evidence_digest=terminal_digest_value
    WHERE reservation_id = reservation_value;
  UPDATE core.operations
    SET status='succeeded', finished_at=terminal_time,
        result=jsonb_build_object('terminalOwnerVerified', true,
          'ownerSourceVersion', owner_source_value,
          'terminalEvidenceDigest', encode(terminal_digest_value,'hex'))
    WHERE id = reservation.predecessor_operation_id;
  UPDATE core.framework_operations SET state='completed', terminal_at=terminal_time
    WHERE operation_id = reservation.canonical_operation_id;
  INSERT INTO core.framework_executions
    (agent_execution_id, framework_id, agent_profile_id, operation_id,
     native_execution_alias, source_version, state, observed_at, payload_digest)
  VALUES
    (core.generate_alica_id('aex'), policy.framework_id, policy.context_agent_profile_id,
     reservation.canonical_operation_id, 'phase7:' || reservation.reservation_id,
     owner_source_value, 'succeeded', terminal_time, terminal_digest_value);
END
$$;

CREATE OR REPLACE FUNCTION core.record_phase7_canary_fault(
  policy_value text,
  fault_class_value text,
  expected_result_value text,
  evidence_digest_value bytea,
  safe_code_value text,
  increment_failure boolean DEFAULT false
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  fault_value text := core.generate_alica_id('flt');
  policy core.framework_command_canary_policies%ROWTYPE;
BEGIN
  SELECT * INTO policy FROM core.framework_command_canary_policies
    WHERE canary_policy_id = policy_value FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'P7_POLICY_NOT_FOUND' USING ERRCODE = 'P7001'; END IF;
  INSERT INTO core.framework_command_canary_faults
    (fault_id, canary_policy_id, fault_class, expected_result,
     owner_dispatch_count, evidence_digest, safe_code)
  VALUES
    (fault_value, policy_value, fault_class_value, expected_result_value,
     0, evidence_digest_value, safe_code_value);
  IF increment_failure THEN
    UPDATE core.framework_command_canary_policies
      SET failure_count = failure_count + 1,
          circuit_state = CASE WHEN failure_count + 1 >= failure_threshold THEN 'open' ELSE circuit_state END,
          enabled = CASE WHEN failure_count + 1 >= failure_threshold THEN false ELSE enabled END
      WHERE canary_policy_id = policy_value;
  END IF;
  RETURN fault_value;
END
$$;

CREATE OR REPLACE FUNCTION core.disable_phase7_canary(policy_value text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE core.framework_command_canary_policies
    SET enabled=false, circuit_state='disabled', disabled_at=coalesce(disabled_at,clock_timestamp())
    WHERE canary_policy_id=policy_value;
  IF NOT FOUND THEN RAISE EXCEPTION 'P7_POLICY_NOT_FOUND' USING ERRCODE = 'P7001'; END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION core.reserve_phase7_canary_command(text,text,text,text,text,text,text,text,text,text,text,text,bytea,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.start_phase7_canary_dispatch(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.complete_phase7_canary_dispatch(text,text,text,bytea) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.record_phase7_canary_fault(text,text,text,bytea,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION core.disable_phase7_canary(text) FROM PUBLIC;
