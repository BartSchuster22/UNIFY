DROP TRIGGER IF EXISTS framework_rollout_observations_append_only ON framework_rollout_observations;
DROP FUNCTION IF EXISTS prevent_framework_rollout_observation_mutation();
DROP TABLE IF EXISTS framework_rollout_observations;

ALTER TABLE framework_rollout_targets DROP COLUMN observation_checks;
ALTER TABLE framework_rollout_targets DROP CONSTRAINT framework_rollout_targets_state_check;
ALTER TABLE framework_rollout_targets ADD CONSTRAINT framework_rollout_targets_state_check
  CHECK (state IN ('planned','dry_run_passed','pending','executing','converged','failed','cancelled'));

DROP INDEX framework_rollout_one_active;
CREATE UNIQUE INDEX framework_rollout_one_active_candidate
  ON framework_rollout_plans(candidate_id)
  WHERE state IN ('planned','dry_run_passed','approved','queued','executing');

ALTER TABLE framework_rollout_plans
  DROP CONSTRAINT framework_rollout_promotion_actor,
  DROP CONSTRAINT framework_rollout_source_kind,
  DROP COLUMN rollback_reason,
  DROP COLUMN promoted_at,
  DROP COLUMN promoted_by,
  DROP COLUMN observation_completed_at,
  DROP COLUMN observation_deadline_at,
  DROP COLUMN observation_started_at,
  DROP COLUMN policy_snapshot,
  DROP COLUMN source_plan_id,
  DROP COLUMN operation_kind;
ALTER TABLE framework_rollout_plans DROP CONSTRAINT framework_rollout_plans_state_check;
ALTER TABLE framework_rollout_plans ADD CONSTRAINT framework_rollout_plans_state_check
  CHECK (state IN ('planned','dry_run_passed','approved','queued','executing','succeeded','partial','failed','cancelled'));

CREATE OR REPLACE FUNCTION prevent_framework_rollout_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_id <> OLD.plan_id OR NEW.candidate_id <> OLD.candidate_id
     OR NEW.assessment_id <> OLD.assessment_id OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'framework rollout plan identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TABLE framework_release_policies;
