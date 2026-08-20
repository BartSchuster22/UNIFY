-- Idempotent forward repair for predecessor rows discovered after migration 012.
-- Existing canonical IDs and aliases are never updated or reassigned.

WITH candidates AS (
  SELECT profile.*, metadata.accepted_release, metadata.accepted_commit,
         core.generate_alica_id('agp') AS canonical_id
  FROM core.profiles profile
  JOIN core.framework_instance_metadata metadata ON metadata.framework_id = profile.framework_id
  WHERE NOT EXISTS (
    SELECT 1 FROM core.agent_profile_projections projection
    WHERE projection.predecessor_profile_id = profile.id
  )
)
INSERT INTO core.agent_profile_projections
  (agent_profile_id, framework_id, native_profile_alias, source_version, owner_release, owner_commit,
   observed_at, freshness_state, fresh_until, payload_schema_key, payload_digest,
   safe_display_name, safe_description, protected, activity_state, predecessor_profile_id)
SELECT canonical_id, framework_id, native_reference, coalesce(source_version, 'predecessor-unversioned'),
       accepted_release, accepted_commit, coalesce(last_observed_at, updated_at),
       CASE observed_state WHEN 'active' THEN 'current' WHEN 'missing' THEN 'deleted'
         WHEN 'unavailable' THEN 'unavailable' ELSE 'stale' END,
       NULL, 'hermes-profile-safe/v1', digest(id || ':' || native_reference || ':' || coalesce(source_version, ''), 'sha256'),
       name, description, protected,
       CASE WHEN desired_state = 'deleted' THEN 'deleted'
         WHEN observed_state IN ('active','inactive','missing','unavailable') THEN observed_state
         ELSE 'inactive' END,
       id
FROM candidates;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace, alias_value, alias_kind, source_reference)
SELECT projection.framework_id, 'profile', projection.agent_profile_id, 'core.profiles.id', projection.predecessor_profile_id,
       'predecessor-core', 'core.profiles'
FROM core.agent_profile_projections projection
ON CONFLICT DO NOTHING;

WITH candidates AS (
  SELECT operation.*, framework.id AS mapped_framework_id,
         profile_projection.agent_profile_id AS mapped_profile_id,
         core.generate_alica_id('op') AS canonical_id
  FROM core.operations operation
  LEFT JOIN core.frameworks framework
    ON operation.target_kind = 'framework' AND framework.id = operation.target_id
  LEFT JOIN core.agent_profile_projections profile_projection
    ON operation.target_kind = 'profile' AND profile_projection.predecessor_profile_id = operation.target_id
  WHERE (framework.id IS NOT NULL OR profile_projection.agent_profile_id IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM core.framework_operations mapped
      WHERE mapped.predecessor_operation_id = operation.id
    )
)
INSERT INTO core.framework_operations
  (operation_id, predecessor_operation_id, framework_id, agent_profile_id, command_id,
   actor_predecessor_reference, capability_key, mode, idempotency_key, request_digest,
   authorization_state, state, retention_policy_key, requested_at, terminal_at)
SELECT canonical_id, id, coalesce(mapped_framework_id,
       (SELECT framework_id FROM core.agent_profile_projections WHERE agent_profile_id = mapped_profile_id)),
       mapped_profile_id, command_id, actor_kind || ':' || actor_id,
       command_type, 'execute', idempotency_key, payload_digest,
       'held', CASE status WHEN 'succeeded' THEN 'completed' WHEN 'failed' THEN 'failed'
         WHEN 'cancelled' THEN 'cancelled' WHEN 'running' THEN 'dispatched' ELSE 'requested' END,
       'operations-evidence-default/v1', accepted_at, finished_at
FROM candidates;

INSERT INTO core.framework_native_aliases
  (framework_id, canonical_resource_kind, canonical_resource_id, alias_namespace, alias_value, alias_kind, source_reference)
SELECT operation.framework_id, 'operation', operation.operation_id, 'core.operations.id', operation.predecessor_operation_id,
       'predecessor-core', 'core.operations'
FROM core.framework_operations operation
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_event_receipts
  (framework_id, stream_key, owner_event_id, payload_digest, source_version,
   canonical_event_id, classification_schema_key, received_at)
SELECT receipt.source_framework_id, 'core.inbound', receipt.source_event_id, receipt.payload_digest,
       'predecessor-unversioned', NULL, 'digest-only/v1', receipt.received_at
FROM core.inbound_receipts receipt
JOIN core.framework_instance_metadata metadata ON metadata.framework_id = receipt.source_framework_id
ON CONFLICT DO NOTHING;

INSERT INTO core.framework_migration_evidence
  (evidence_id, migration_contract, action, source_digest, result_digest)
SELECT core.generate_alica_id('evd'), 'alica-hermes-projection-migration/v0.1', 'forward-repair',
       digest((SELECT count(*)::text FROM core.profiles) || ':' ||
              (SELECT count(*)::text FROM core.operations) || ':' ||
              (SELECT count(*)::text FROM core.inbound_receipts), 'sha256'),
       digest((SELECT count(*)::text FROM core.agent_profile_projections) || ':' ||
              (SELECT count(*)::text FROM core.framework_operations) || ':' ||
              (SELECT count(*)::text FROM core.framework_event_receipts), 'sha256');
