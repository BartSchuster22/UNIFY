-- Synthetic, secret-free predecessor corpus for an isolated database only.
CREATE TABLE public.framework_registrations (
  id text PRIMARY KEY,
  adapter_id text NOT NULL,
  display_name text NOT NULL
);
CREATE TABLE public.event_cursors (
  bridge_id text PRIMARY KEY,
  durable_cursor text,
  replay_state text NOT NULL
);

INSERT INTO public.framework_registrations VALUES ('hermes-main', 'hermes-control/v1', 'Hermes fixture');
INSERT INTO public.event_cursors VALUES ('hermes-main', 'opaque-cursor-0007', 'current');

INSERT INTO core.service_principals (id, name)
VALUES ('svc_01ARZ3NDEKTSV4RRFFQ69G5FA1', 'hermes-phase5-fixture');

INSERT INTO core.frameworks
  (id, name, endpoint, credential_reference, desired_state, observed_state, observed_version)
VALUES
  ('frm_01ARZ3NDEKTSV4RRFFQ69G5FA2', 'Hermes Phase 5 fixture',
   'https://phase5.invalid', 'secret://phase5/hermes', 'active', 'available', '0.20.0');

INSERT INTO core.framework_gateway_policies
  (framework_id, expected_native_framework_id, expected_instance_id, expected_release,
   expected_commit, request_timeout_ms, retry_limit, retry_base_delay_ms, maximum_response_bytes,
   circuit_failure_threshold, circuit_open_ms)
VALUES
  ('frm_01ARZ3NDEKTSV4RRFFQ69G5FA2', 'hermes-main', 'hermes-phase5-isolated', '0.20.0',
   'b8b17b8cee50b85adb7fba6ea332dc06731b86f4', 5000, 2, 100, 2097152, 3, 30000);

INSERT INTO core.profiles
  (id, framework_id, native_reference, name, description, protected, desired_state,
   observed_state, observed_version, source_version, last_observed_at)
VALUES
  ('prf_01ARZ3NDEKTSV4RRFFQ69G5FA3', 'frm_01ARZ3NDEKTSV4RRFFQ69G5FA2',
   'native-profile-alpha', 'Fixture Alpha', 'Safe fixture metadata', false, 'active',
   'active', 'owner-v7', 'profiles-v7', '2026-08-20T00:00:00Z');

INSERT INTO core.operations
  (id, command_id, command_type, actor_kind, actor_id, target_kind, target_id,
   idempotency_key, payload_digest, payload, status)
VALUES
  ('opc_01ARZ3NDEKTSV4RRFFQ69G5FA4', 'cmd_01ARZ3NDEKTSV4RRFFQ69G5FA5',
   'framework.reconcile.v1', 'service', 'svc_01ARZ3NDEKTSV4RRFFQ69G5FA1',
   'framework', 'frm_01ARZ3NDEKTSV4RRFFQ69G5FA2', 'phase5-fixture-key-0001',
   digest('safe-phase5-request', 'sha256'), '{"fixture":true}'::jsonb, 'accepted');

INSERT INTO core.events
  (id, event_type, aggregate_kind, aggregate_id, operation_id, correlation_id, payload, occurred_at)
VALUES
  ('evt_01ARZ3NDEKTSV4RRFFQ69G5FA6', 'framework.observed.v1', 'framework',
   'frm_01ARZ3NDEKTSV4RRFFQ69G5FA2', 'opc_01ARZ3NDEKTSV4RRFFQ69G5FA4',
   'cor_01ARZ3NDEKTSV4RRFFQ69G5FA7', '{"classification":"safe-fixture"}'::jsonb,
   '2026-08-20T00:01:00Z');

INSERT INTO core.event_consumers (consumer_key, cursor_position)
VALUES ('hermes.fixture.primary', 1);

INSERT INTO core.inbound_receipts
  (source_framework_id, source_event_id, payload_digest, operation_id)
VALUES
  ('frm_01ARZ3NDEKTSV4RRFFQ69G5FA2', 'owner-event-0007',
   digest('safe-event-digest', 'sha256'), 'opc_01ARZ3NDEKTSV4RRFFQ69G5FA4');

INSERT INTO core.conversations
  (id, profile_id, title, ownership, owner_kind, owner_id, last_sequence)
VALUES
  ('cvs_01ARZ3NDEKTSV4RRFFQ69G5FA8', 'prf_01ARZ3NDEKTSV4RRFFQ69G5FA3',
   'Held predecessor conversation', 'core', 'service', 'svc_01ARZ3NDEKTSV4RRFFQ69G5FA1', 1);

INSERT INTO core.conversation_messages
  (id, conversation_id, sender_kind, sender_id, sequence, state, blocks)
VALUES
  ('msg_01ARZ3NDEKTSV4RRFFQ69G5FA9', 'cvs_01ARZ3NDEKTSV4RRFFQ69G5FA8',
   'service', 'svc_01ARZ3NDEKTSV4RRFFQ69G5FA1', 1, 'complete',
   '[{"kind":"text","text":"safe synthetic fixture"}]'::jsonb);

INSERT INTO core.conversation_dispatches
  (id, conversation_id, request_message_id, profile_id, state)
VALUES
  ('run_01ARZ3NDEKTSV4RRFFQ69G5FAA', 'cvs_01ARZ3NDEKTSV4RRFFQ69G5FA8',
   'msg_01ARZ3NDEKTSV4RRFFQ69G5FA9', 'prf_01ARZ3NDEKTSV4RRFFQ69G5FA3', 'pending');

INSERT INTO core.work_projects (id, name, goal, state)
VALUES ('prj_01ARZ3NDEKTSV4RRFFQ69G5FAB', 'Held work run fixture', 'Classify only', 'saved');
INSERT INTO core.work_project_profiles (project_id, profile_id, role)
VALUES ('prj_01ARZ3NDEKTSV4RRFFQ69G5FAB', 'prf_01ARZ3NDEKTSV4RRFFQ69G5FA3', 'manager');
UPDATE core.work_projects SET project_manager_profile_id = 'prf_01ARZ3NDEKTSV4RRFFQ69G5FA3'
WHERE id = 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAB';
INSERT INTO core.work_schedules (id, project_id, kind, expression, timezone, next_run_at)
VALUES ('sch_01ARZ3NDEKTSV4RRFFQ69G5FAC', 'prj_01ARZ3NDEKTSV4RRFFQ69G5FAB',
        'every', '1h', 'UTC', '2026-08-20T01:00:00Z');
INSERT INTO core.work_runs (id, schedule_id, state, scheduled_for)
VALUES ('run_01ARZ3NDEKTSV4RRFFQ69G5FAD', 'sch_01ARZ3NDEKTSV4RRFFQ69G5FAC',
        'queued', '2026-08-20T01:00:00Z');
