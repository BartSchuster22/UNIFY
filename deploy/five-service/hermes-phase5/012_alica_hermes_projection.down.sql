-- Structural rollback is safe only before canonical rows/aliases exist.
-- Once data exists, use forward repair or restore the complete authority database.
DO $$
DECLARE
  populated boolean;
BEGIN
  SELECT
    EXISTS (SELECT 1 FROM core.framework_instance_metadata)
    OR EXISTS (SELECT 1 FROM core.framework_native_aliases)
    OR EXISTS (SELECT 1 FROM core.framework_registrations)
    OR EXISTS (SELECT 1 FROM core.agent_profile_projections)
    OR EXISTS (SELECT 1 FROM core.product_agent_profile_bindings)
    OR EXISTS (SELECT 1 FROM core.framework_capability_state)
    OR EXISTS (SELECT 1 FROM core.framework_operations)
    OR EXISTS (SELECT 1 FROM core.framework_executions)
    OR EXISTS (SELECT 1 FROM core.framework_session_projections)
    OR EXISTS (SELECT 1 FROM core.chat_framework_links)
    OR EXISTS (SELECT 1 FROM core.framework_projection_state)
    OR EXISTS (SELECT 1 FROM core.framework_event_stream_state)
    OR EXISTS (SELECT 1 FROM core.framework_event_receipts)
    OR EXISTS (SELECT 1 FROM core.framework_compatibility_edges)
    OR EXISTS (SELECT 1 FROM core.framework_predecessor_holds)
  INTO populated;
  IF populated THEN
    RAISE EXCEPTION 'ALICA_HERMES_FORWARD_REPAIR_REQUIRED: canonical rows or evidence exist'
      USING ERRCODE = '55000';
  END IF;
END
$$;

DROP TABLE core.framework_migration_evidence;
DROP TABLE core.framework_predecessor_holds;
DROP TABLE core.framework_compatibility_edges;
DROP TABLE core.framework_event_receipts;
DROP TABLE core.framework_event_stream_state;
DROP TABLE core.framework_projection_state;
DROP TABLE core.chat_framework_links;
DROP TABLE core.framework_session_projections;
DROP TABLE core.framework_executions;
DROP TABLE core.framework_operations;
DROP TABLE core.framework_capability_state;
DROP TABLE core.product_agent_profile_bindings;
DROP TABLE core.agent_profile_projections;
DROP TABLE core.framework_registrations;
DROP TABLE core.framework_native_aliases;
DROP TABLE core.framework_instance_metadata;
DROP TABLE core.framework_types;
DROP FUNCTION core.generate_alica_id(text);
