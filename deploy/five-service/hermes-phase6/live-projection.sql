\set ON_ERROR_STOP on

-- Phase 6 exact-target projection seed. This file is additive and idempotent.
-- It contains only redacted owner observations captured through GET endpoints.
DO $$
BEGIN
  IF current_database() <> 'unify' OR current_user <> 'unify' THEN
    RAISE EXCEPTION 'PHASE6_TARGET_MISMATCH';
  END IF;
  IF (SELECT count(*) FROM public.framework_registrations WHERE id = 'hermes-main' AND adapter_id = 'hermes-control/v1' AND enabled) <> 1 THEN
    RAISE EXCEPTION 'PHASE6_REGISTRATION_MISMATCH';
  END IF;
  IF (SELECT array_agg(version ORDER BY version) FROM core.schema_migrations) <> ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::integer[] THEN
    RAISE EXCEPTION 'PHASE6_MIGRATION_LINEAGE_MISMATCH';
  END IF;
END
$$;

INSERT INTO core.frameworks
  (id, name, endpoint, credential_reference, desired_state, observed_state,
   observed_version, last_health_at, last_health_detail)
SELECT core.generate_alica_id('frm'), 'Herman', registration.base_url,
       'secret://unify/hermes-main/control-token', 'active', 'degraded',
       '0.20.0', '2026-08-20T06:50:05.384Z'::timestamptz,
       '{"cli":"healthy","management":"healthy","conversations":"degraded","eventStore":"healthy"}'::jsonb
FROM public.framework_registrations registration
WHERE registration.id = 'hermes-main'
  AND NOT EXISTS (
    SELECT 1 FROM core.framework_gateway_policies policy
    WHERE policy.expected_native_framework_id = 'hermes-main'
  );

INSERT INTO core.framework_gateway_policies
  (framework_id, expected_native_framework_id, expected_instance_id,
   expected_release, expected_commit)
SELECT framework.id, 'hermes-main', 'herman-local-private', '0.20.0',
       'b8b17b8cee50b85adb7fba6ea332dc06731b86f4'
FROM core.frameworks framework
WHERE framework.name = 'Herman'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_instance_metadata
  (framework_id, framework_type_key, runtime_identity_key,
   accepted_adapter_contract, accepted_release, accepted_commit,
   desired_lifecycle, observed_lifecycle)
SELECT policy.framework_id, 'hermes-agent/v1', policy.expected_instance_id,
       'hermes-control/v1', policy.expected_release, policy.expected_commit,
       'active', 'degraded'
FROM core.framework_gateway_policies policy
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id,
   alias_namespace, alias_value, alias_kind, source_reference)
SELECT policy.framework_id, 'framework', policy.framework_id,
       alias.alias_namespace, alias.alias_value, alias.alias_kind, alias.source_reference
FROM core.framework_gateway_policies policy
CROSS JOIN LATERAL (VALUES
  ('core.frameworks.id', policy.framework_id, 'predecessor-core', 'core.frameworks'),
  ('hermes.native-framework', 'hermes-main', 'native-framework', 'owner:/control/v1/identity'),
  ('hermes.native-instance', 'herman-local-private', 'native-instance', 'owner:/control/v1/identity'),
  ('gateway.framework_registrations.id', 'hermes-main', 'predecessor-gateway', 'public.framework_registrations')
) AS alias(alias_namespace, alias_value, alias_kind, source_reference)
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

WITH owner_profiles(native_reference, display_name) AS (
  VALUES
    ('default','Herman'),
    ('chatboard','chatboard'),
    ('devops-agent','devops-agent'),
    ('pm-agent','pm-agent'),
    ('test-agent','test-agent'),
    ('ulrich','ulrich')
)
INSERT INTO core.profiles
  (id, framework_id, native_reference, name, protected, desired_state,
   observed_state, observed_version, source_version, last_observed_at)
SELECT core.generate_alica_id('prf'), policy.framework_id, owner.native_reference,
       owner.display_name, owner.native_reference = 'default', 'active', 'unknown',
       '0.20.0', 'sha256:fa9d4d75c8977989085cb20706693104ab7469b6b2ddd5aefa801c1968aee148',
       '2026-08-20T06:50:05.545Z'::timestamptz
FROM owner_profiles owner
CROSS JOIN core.framework_gateway_policies policy
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.agent_profile_projections
  (agent_profile_id, framework_id, native_profile_alias, source_version,
   owner_release, owner_commit, observed_at, freshness_state, fresh_until,
   payload_schema_key, payload_digest, safe_display_name, protected,
   activity_state, predecessor_profile_id)
SELECT core.generate_alica_id('agp'), profile.framework_id, profile.native_reference,
       profile.source_version, '0.20.0',
       'b8b17b8cee50b85adb7fba6ea332dc06731b86f4', profile.last_observed_at,
       'current', profile.last_observed_at + interval '10 minutes',
       'hermes-profile-safe/v1',
       digest(profile.native_reference || ':' || profile.name || ':' || profile.source_version, 'sha256'),
       profile.name, profile.protected, 'inactive', profile.id
FROM core.profiles profile
JOIN core.framework_gateway_policies policy ON policy.framework_id = profile.framework_id
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id,
   alias_namespace, alias_value, alias_kind, source_reference)
SELECT projection.framework_id, 'profile', projection.agent_profile_id,
       'hermes.native-profile', projection.native_profile_alias, 'native-resource',
       'owner:/control/v1/profiles'
FROM core.agent_profile_projections projection
JOIN core.framework_gateway_policies policy ON policy.framework_id = projection.framework_id
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_capability_state
  (framework_id, capability_key, status, allowed_modes, adapter_scope_ceiling,
   safe_reason_code, source_version, owner_release, owner_commit, observed_at, fresh_until)
SELECT policy.framework_id, capability.capability_key, capability.status,
       capability.allowed_modes, capability.scope_ceiling, capability.reason_code,
       'adapter:fcb3cbf', '0.20.0', 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
       '2026-08-20T06:50:01.177Z'::timestamptz,
       '2026-08-20T07:00:01.177Z'::timestamptz
FROM core.framework_gateway_policies policy
CROSS JOIN (VALUES
  ('profiles.read','supported',ARRAY['read']::text[],ARRAY['control:read']::text[],NULL::text),
  ('conversations.sessions.read','unavailable',ARRAY[]::text[],ARRAY['control:read']::text[],'HERMES_API_NOT_CONFIGURED'),
  ('conversations.messages.read','unavailable',ARRAY[]::text[],ARRAY['control:read']::text[],'HERMES_API_NOT_CONFIGURED'),
  ('events.read','unavailable',ARRAY[]::text[],ARRAY['control:events']::text[],'OWNER_CAPABILITY_UNADVERTISED')
) capability(capability_key,status,allowed_modes,scope_ceiling,reason_code)
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_projection_state
  (framework_id, projection_family, accepted_source_version, payload_digest,
   accepted_generation, item_count, observed_at, fresh_until, status,
   rebuild_state, retention_policy_key, safe_reason_code)
SELECT policy.framework_id, state.family, state.source_version,
       CASE WHEN state.source_version IS NULL THEN NULL ELSE digest(state.source_version, 'sha256') END,
       state.generation, state.item_count, state.observed_at, state.fresh_until,
       state.status, state.rebuild_state, 'hermes-projection-evidence/v1', state.reason_code
FROM core.framework_gateway_policies policy
CROSS JOIN (VALUES
  ('profiles','sha256:fa9d4d75c8977989085cb20706693104ab7469b6b2ddd5aefa801c1968aee148',1::bigint,6,'2026-08-20T06:50:05.545Z'::timestamptz,'2026-08-20T07:00:05.545Z'::timestamptz,'current','current',NULL::text),
  ('sessions',NULL::text,0::bigint,0,'2026-08-20T06:50:05.384Z'::timestamptz,NULL::timestamptz,'unavailable','held','HERMES_API_NOT_CONFIGURED'),
  ('messages',NULL::text,0::bigint,0,'2026-08-20T06:50:05.384Z'::timestamptz,NULL::timestamptz,'unavailable','held','HERMES_API_NOT_CONFIGURED')
) state(family,source_version,generation,item_count,observed_at,fresh_until,status,rebuild_state,reason_code)
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_event_stream_state
  (framework_id, stream_key, owner_cursor, state, safe_error_code)
SELECT policy.framework_id, cursor.bridge_id, cursor.durable_cursor, 'held',
       'OWNER_CAPABILITY_UNADVERTISED'
FROM public.event_cursors cursor
CROSS JOIN core.framework_gateway_policies policy
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_predecessor_holds
  (hold_id, predecessor_schema, predecessor_table, predecessor_key,
   framework_id, reason_code, evidence_digest)
SELECT core.generate_alica_id('hld'), hold.predecessor_schema, hold.predecessor_table,
       hold.predecessor_key, policy.framework_id, hold.reason_code,
       digest(hold.predecessor_schema || ':' || hold.predecessor_table || ':' || hold.predecessor_key || ':' || hold.reason_code, 'sha256')
FROM core.framework_gateway_policies policy
CROSS JOIN (VALUES
  ('public','framework_registrations','hermes-main','IDENTITY_CONTEXT_MISSING'),
  ('public','event_cursors','hermes-control:hermes-main','OWNER_CAPABILITY_UNADVERTISED'),
  ('owner','conversations','hermes-main','CHAT_OWNERSHIP_UNRESOLVED')
) hold(predecessor_schema,predecessor_table,predecessor_key,reason_code)
WHERE policy.expected_native_framework_id = 'hermes-main'
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_gateway_observations
  (id, framework_id, kind, source_version, credential_version, document, observed_at)
SELECT core.generate_alica_id('fob'), policy.framework_id, observation.kind,
       observation.source_version, 'phase6-read-only', observation.document, observation.observed_at
FROM core.framework_gateway_policies policy
CROSS JOIN (VALUES
  ('identity','identity','{"runtime":"hermes-agent","instanceId":"herman-local-private","displayName":"Herman"}'::jsonb,'2026-08-20T06:50:01.182Z'::timestamptz),
  ('version','git:b8b17b8cee50b85adb7fba6ea332dc06731b86f4','{"release":"0.20.0","commit":"b8b17b8cee50b85adb7fba6ea332dc06731b86f4","dirty":false,"pythonVersion":"3.13.5"}'::jsonb,'2026-08-20T06:50:01.171Z'::timestamptz),
  ('health','sha256:b9e79cc8fd6b06175d39484151a3fa3cadfea3290ad2e8587f8bedf068d49bb1','{"status":"degraded","checks":{"cli":"healthy","management":"healthy","conversations":"degraded","eventStore":"healthy"}}'::jsonb,'2026-08-20T06:50:05.384Z'::timestamptz),
  ('capabilities','adapter:fcb3cbf','{"profiles.read":"supported","events.read":"unadvertised","conversations.sessions.read":"unavailable","conversations.messages.read":"unavailable"}'::jsonb,'2026-08-20T06:50:01.177Z'::timestamptz)
) observation(kind,source_version,document,observed_at)
WHERE policy.expected_native_framework_id = 'hermes-main'
  AND NOT EXISTS (
    SELECT 1 FROM core.framework_gateway_observations existing
    WHERE existing.framework_id = policy.framework_id
      AND existing.kind = observation.kind
      AND existing.source_version = observation.source_version
  );

INSERT INTO core.framework_migration_evidence
  (evidence_id, migration_contract, action, source_digest, result_digest)
SELECT core.generate_alica_id('evd'), 'alica-hermes-projection-migration/v0.1',
       'restore-verification',
       digest('phase6:hermes-main:sha256:fa9d4d75c8977989085cb20706693104ab7469b6b2ddd5aefa801c1968aee148', 'sha256'),
       digest((SELECT count(*)::text FROM core.agent_profile_projections) || ':' ||
              (SELECT count(*)::text FROM core.framework_native_aliases) || ':' ||
              (SELECT count(*)::text FROM core.framework_predecessor_holds), 'sha256')
WHERE NOT EXISTS (
  SELECT 1 FROM core.framework_migration_evidence
  WHERE action = 'restore-verification'
);
