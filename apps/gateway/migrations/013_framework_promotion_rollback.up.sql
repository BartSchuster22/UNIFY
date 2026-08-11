CREATE TABLE framework_release_policies (
  policy_id text PRIMARY KEY CHECK (policy_id='default'),
  canary_framework_id text NOT NULL CHECK (canary_framework_id IN ('hermes-alica','hermes-herman')),
  observation_window_seconds integer NOT NULL CHECK (observation_window_seconds BETWEEN 1 AND 86400),
  required_healthy_samples integer NOT NULL CHECK (required_healthy_samples BETWEEN 1 AND 1000),
  manual_promotion_required boolean NOT NULL DEFAULT true CHECK (manual_promotion_required),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO framework_release_policies(
  policy_id,canary_framework_id,observation_window_seconds,required_healthy_samples
) VALUES('default','hermes-alica',300,3);

ALTER TABLE framework_rollout_plans DROP CONSTRAINT framework_rollout_plans_state_check;
ALTER TABLE framework_rollout_plans ADD CONSTRAINT framework_rollout_plans_state_check
  CHECK (state IN ('planned','dry_run_passed','approved','queued','executing','observing','awaiting_promotion','succeeded','partial','failed','cancelled'));
ALTER TABLE framework_rollout_plans
  ADD COLUMN operation_kind text NOT NULL DEFAULT 'release' CHECK (operation_kind IN ('release','rollback')),
  ADD COLUMN source_plan_id uuid REFERENCES framework_rollout_plans(plan_id),
  ADD COLUMN policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(policy_snapshot)='object'),
  ADD COLUMN observation_started_at timestamptz,
  ADD COLUMN observation_deadline_at timestamptz,
  ADD COLUMN observation_completed_at timestamptz,
  ADD COLUMN promoted_by uuid REFERENCES users(id),
  ADD COLUMN promoted_at timestamptz,
  ADD COLUMN rollback_reason text CHECK (rollback_reason IS NULL OR length(rollback_reason) BETWEEN 3 AND 500),
  ADD CONSTRAINT framework_rollout_source_kind CHECK (
    (operation_kind='release' AND source_plan_id IS NULL AND rollback_reason IS NULL)
    OR (operation_kind='rollback' AND source_plan_id IS NOT NULL AND rollback_reason IS NOT NULL)
  ),
  ADD CONSTRAINT framework_rollout_promotion_actor CHECK ((promoted_by IS NULL)=(promoted_at IS NULL));

CREATE OR REPLACE FUNCTION prevent_framework_rollout_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_id <> OLD.plan_id OR NEW.candidate_id <> OLD.candidate_id
     OR NEW.assessment_id <> OLD.assessment_id OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at OR NEW.operation_kind <> OLD.operation_kind
     OR NEW.source_plan_id IS DISTINCT FROM OLD.source_plan_id
     OR NEW.policy_snapshot <> OLD.policy_snapshot
     OR NEW.rollback_reason IS DISTINCT FROM OLD.rollback_reason THEN
    RAISE EXCEPTION 'framework rollout plan identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX framework_rollout_one_active_candidate;
CREATE UNIQUE INDEX framework_rollout_one_active
  ON framework_rollout_plans((true))
  WHERE state IN ('planned','dry_run_passed','approved','queued','executing','observing','awaiting_promotion');

ALTER TABLE framework_rollout_targets DROP CONSTRAINT framework_rollout_targets_state_check;
ALTER TABLE framework_rollout_targets ADD CONSTRAINT framework_rollout_targets_state_check
  CHECK (state IN ('planned','dry_run_passed','pending','awaiting_promotion','executing','converged','failed','cancelled'));
ALTER TABLE framework_rollout_targets
  ADD COLUMN observation_checks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(observation_checks)='object');

CREATE TABLE framework_rollout_observations (
  observation_id bigserial PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES framework_rollout_plans(plan_id) ON DELETE CASCADE,
  framework_id text NOT NULL,
  healthy boolean NOT NULL,
  image_identity boolean NOT NULL,
  release_identity boolean NOT NULL,
  commit_identity boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  observed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(plan_id,framework_id) REFERENCES framework_rollout_targets(plan_id,framework_id) ON DELETE CASCADE
);
CREATE INDEX framework_rollout_observations_stream
  ON framework_rollout_observations(plan_id,observation_id);

CREATE OR REPLACE FUNCTION prevent_framework_rollout_observation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'framework rollout observations are append-only';
END;
$$;
CREATE TRIGGER framework_rollout_observations_append_only
BEFORE UPDATE OR DELETE ON framework_rollout_observations
FOR EACH ROW EXECUTE FUNCTION prevent_framework_rollout_observation_mutation();
