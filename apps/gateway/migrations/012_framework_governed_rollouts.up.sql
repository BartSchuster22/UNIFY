CREATE TABLE framework_rollout_plans (
  plan_id uuid PRIMARY KEY,
  candidate_id text NOT NULL REFERENCES framework_update_candidates(candidate_id),
  assessment_id text NOT NULL REFERENCES framework_candidate_assessments(assessment_id),
  state text NOT NULL CHECK (state IN ('planned','dry_run_passed','approved','queued','executing','succeeded','partial','failed','cancelled')),
  created_by uuid NOT NULL REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  dry_run_at timestamptz,
  approved_at timestamptz,
  execution_requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{3,100}$'),
  failure_reason text CHECK (failure_reason IS NULL OR length(failure_reason) BETWEEN 1 AND 1000),
  CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

CREATE UNIQUE INDEX framework_rollout_one_active_candidate
  ON framework_rollout_plans(candidate_id)
  WHERE state IN ('planned','dry_run_passed','approved','queued','executing');

CREATE TABLE framework_rollout_targets (
  plan_id uuid NOT NULL REFERENCES framework_rollout_plans(plan_id) ON DELETE CASCADE,
  framework_id text NOT NULL REFERENCES framework_registrations(id),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  state text NOT NULL CHECK (state IN ('planned','dry_run_passed','pending','executing','converged','failed','cancelled')),
  previous_release_id text NOT NULL,
  previous_image_reference text NOT NULL,
  previous_image_digest text NOT NULL CHECK (previous_image_digest ~ '^sha256:[a-f0-9]{64}$'),
  previous_framework_version text NOT NULL,
  previous_framework_commit text NOT NULL CHECK (previous_framework_commit ~ '^[a-f0-9]{40}$'),
  target_release_id text NOT NULL,
  target_image_reference text NOT NULL,
  target_image_digest text NOT NULL CHECK (target_image_digest ~ '^sha256:[a-f0-9]{64}$'),
  target_framework_version text NOT NULL,
  target_framework_commit text NOT NULL CHECK (target_framework_commit ~ '^[a-f0-9]{40}$'),
  progress integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  dry_run_checks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dry_run_checks)='object'),
  convergence_checks jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(convergence_checks)='object'),
  worker_id text,
  lease_expires_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[A-Z0-9_]{3,100}$'),
  safe_error_reason text CHECK (safe_error_reason IS NULL OR length(safe_error_reason) BETWEEN 1 AND 1000),
  PRIMARY KEY(plan_id,framework_id),
  UNIQUE(plan_id,ordinal),
  CHECK (framework_id IN ('hermes-alica','hermes-herman'))
);

CREATE INDEX framework_rollout_targets_claim
  ON framework_rollout_targets(state,ordinal)
  WHERE state IN ('pending','executing');

CREATE TABLE framework_rollout_events (
  event_id bigserial PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES framework_rollout_plans(plan_id) ON DELETE CASCADE,
  framework_id text,
  state text NOT NULL,
  progress integer NOT NULL CHECK (progress BETWEEN 0 AND 100),
  safe_message text NOT NULL CHECK (length(safe_message) BETWEEN 1 AND 1000),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details)='object'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX framework_rollout_events_stream ON framework_rollout_events(plan_id,event_id);

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
CREATE TRIGGER framework_rollout_plan_identity_immutable
BEFORE UPDATE ON framework_rollout_plans
FOR EACH ROW EXECUTE FUNCTION prevent_framework_rollout_identity_mutation();

CREATE OR REPLACE FUNCTION prevent_framework_rollout_target_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plan_id <> OLD.plan_id OR NEW.framework_id <> OLD.framework_id OR NEW.ordinal <> OLD.ordinal
     OR NEW.previous_release_id <> OLD.previous_release_id
     OR NEW.previous_image_reference <> OLD.previous_image_reference
     OR NEW.previous_image_digest <> OLD.previous_image_digest
     OR NEW.previous_framework_version <> OLD.previous_framework_version
     OR NEW.previous_framework_commit <> OLD.previous_framework_commit
     OR NEW.target_release_id <> OLD.target_release_id
     OR NEW.target_image_reference <> OLD.target_image_reference
     OR NEW.target_image_digest <> OLD.target_image_digest
     OR NEW.target_framework_version <> OLD.target_framework_version
     OR NEW.target_framework_commit <> OLD.target_framework_commit THEN
    RAISE EXCEPTION 'framework rollout target identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER framework_rollout_target_identity_immutable
BEFORE UPDATE ON framework_rollout_targets
FOR EACH ROW EXECUTE FUNCTION prevent_framework_rollout_target_identity_mutation();
