\set ON_ERROR_STOP on

DO $$
DECLARE
  value integer;
BEGIN
  SELECT count(*) INTO value FROM core.framework_instance_metadata;
  IF value <> 1 THEN RAISE EXCEPTION 'expected one framework instance metadata row, got %', value; END IF;
  SELECT count(*) INTO value FROM core.agent_profile_projections;
  IF value <> 1 THEN RAISE EXCEPTION 'expected one profile mapping, got %', value; END IF;
  SELECT count(*) INTO value FROM core.framework_operations;
  IF value <> 1 THEN RAISE EXCEPTION 'expected one operation mapping, got %', value; END IF;
  SELECT count(*) INTO value FROM core.framework_event_receipts;
  IF value <> 1 THEN RAISE EXCEPTION 'expected one event receipt, got %', value; END IF;
  SELECT count(*) INTO value FROM core.framework_event_stream_state;
  IF value <> 1 THEN RAISE EXCEPTION 'expected one event stream state, got %', value; END IF;
  SELECT count(*) INTO value FROM core.framework_native_aliases;
  IF value <> 5 THEN RAISE EXCEPTION 'expected five immutable aliases, got %', value; END IF;
  SELECT count(*) INTO value FROM core.framework_predecessor_holds;
  IF value <> 4 THEN RAISE EXCEPTION 'expected four predecessor holds, got %', value; END IF;
  SELECT count(*) INTO value FROM core.framework_registrations;
  IF value <> 0 THEN RAISE EXCEPTION 'registration without Identity context must not be promoted'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM core.framework_native_aliases
    WHERE alias_namespace = 'core.profiles.id'
      AND alias_value = 'prf_01ARZ3NDEKTSV4RRFFQ69G5FA3'
      AND core.is_canonical_id(canonical_resource_id, 'agp')
  ) THEN RAISE EXCEPTION 'profile predecessor alias missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.framework_native_aliases
    WHERE alias_namespace = 'core.operations.id'
      AND alias_value = 'opc_01ARZ3NDEKTSV4RRFFQ69G5FA4'
      AND core.is_canonical_id(canonical_resource_id, 'op')
  ) THEN RAISE EXCEPTION 'operation predecessor alias missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.framework_native_aliases
    WHERE alias_namespace = 'gateway.framework_registrations.id'
      AND alias_value = 'hermes-main'
  ) THEN RAISE EXCEPTION 'gateway registration alias missing'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.framework_event_stream_state
    WHERE framework_id = 'frm_01ARZ3NDEKTSV4RRFFQ69G5FA2'
      AND stream_key = 'hermes-main'
      AND owner_cursor = 'opaque-cursor-0007'
      AND state = 'current'
  ) THEN RAISE EXCEPTION 'event cursor was not preserved'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.framework_predecessor_holds
    WHERE predecessor_table = 'framework_registrations' AND reason_code = 'IDENTITY_CONTEXT_MISSING'
  ) THEN RAISE EXCEPTION 'missing Identity context was not held'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core.framework_predecessor_holds
    WHERE predecessor_table = 'conversations' AND reason_code = 'CHAT_OWNERSHIP_UNRESOLVED'
  ) THEN RAISE EXCEPTION 'conversation ownership was not held'; END IF;
  SELECT count(*) INTO value FROM core.framework_predecessor_holds
  WHERE reason_code = 'RUN_CLASS_AMBIGUOUS';
  IF value <> 2 THEN RAISE EXCEPTION 'both run classes must be held'; END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'core'
      AND table_name IN (
        'agent_profile_projections','framework_operations','framework_executions',
        'framework_session_projections','framework_event_receipts','framework_event_stream_state'
      )
      AND column_name ~ '(secret|credential|prompt|message|tool_input|raw_payload|transcript)'
  ) THEN RAISE EXCEPTION 'base projection exposes prohibited sensitive column'; END IF;
END
$$;

DO $$
BEGIN
  BEGIN
    UPDATE core.framework_native_aliases SET alias_value = 'reassigned'
    WHERE alias_namespace = 'core.profiles.id';
    RAISE EXCEPTION 'immutable alias update unexpectedly succeeded';
  EXCEPTION WHEN sqlstate '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM core.frameworks WHERE id = 'frm_01ARZ3NDEKTSV4RRFFQ69G5FA2';
    RAISE EXCEPTION 'framework evidence delete unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation OR sqlstate '55000' THEN NULL;
  END;
END
$$;

SELECT 'phase5_assertions=PASS';
SELECT 'profile_id=' || agent_profile_id
FROM core.agent_profile_projections
WHERE predecessor_profile_id = 'prf_01ARZ3NDEKTSV4RRFFQ69G5FA3';
SELECT 'operation_id=' || operation_id
FROM core.framework_operations
WHERE predecessor_operation_id = 'opc_01ARZ3NDEKTSV4RRFFQ69G5FA4';
