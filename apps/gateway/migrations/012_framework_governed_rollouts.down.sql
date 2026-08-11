DROP TRIGGER IF EXISTS framework_rollout_target_identity_immutable ON framework_rollout_targets;
DROP FUNCTION IF EXISTS prevent_framework_rollout_target_identity_mutation();
DROP TRIGGER IF EXISTS framework_rollout_plan_identity_immutable ON framework_rollout_plans;
DROP FUNCTION IF EXISTS prevent_framework_rollout_identity_mutation();
DROP TABLE IF EXISTS framework_rollout_events;
DROP TABLE IF EXISTS framework_rollout_targets;
DROP TABLE IF EXISTS framework_rollout_plans;
