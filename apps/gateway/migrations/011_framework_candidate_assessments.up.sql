CREATE TABLE framework_candidate_assessments (
  assessment_id text PRIMARY KEY CHECK (assessment_id ~ '^fca_[a-f0-9]{64}$'),
  candidate_id text NOT NULL REFERENCES framework_update_candidates(candidate_id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('ready','blocked')),
  source_commit text NOT NULL CHECK (source_commit ~ '^[a-f0-9]{40}$'),
  source_archive_digest text NOT NULL CHECK (source_archive_digest ~ '^sha256:[a-f0-9]{64}$'),
  image_reference text,
  image_digest text CHECK (image_digest IS NULL OR image_digest ~ '^sha256:[a-f0-9]{64}$'),
  adapter_release text NOT NULL CHECK (length(adapter_release) BETWEEN 1 AND 200),
  contract_version text NOT NULL CHECK (length(contract_version) BETWEEN 1 AND 100),
  contract_passed boolean NOT NULL,
  acceptance_passed boolean NOT NULL,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence) = 'object'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^sha256:[a-f0-9]{64}$'),
  safe_failure_code text CHECK (safe_failure_code IS NULL OR safe_failure_code ~ '^[A-Z0-9_]{3,100}$'),
  safe_failure_reason text CHECK (safe_failure_reason IS NULL OR length(safe_failure_reason) BETWEEN 1 AND 1000),
  assessed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (state = 'ready' AND image_reference IS NOT NULL AND image_digest IS NOT NULL
      AND contract_passed AND acceptance_passed
      AND safe_failure_code IS NULL AND safe_failure_reason IS NULL)
    OR
    (state = 'blocked' AND safe_failure_code IS NOT NULL AND safe_failure_reason IS NOT NULL)
  ),
  UNIQUE (candidate_id, evidence_digest)
);
CREATE INDEX framework_candidate_assessments_latest
  ON framework_candidate_assessments(candidate_id, assessed_at DESC, recorded_at DESC);

CREATE OR REPLACE FUNCTION prevent_framework_assessment_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'framework candidate assessment evidence is immutable';
END;
$$;
CREATE TRIGGER framework_candidate_assessments_immutable_update
BEFORE UPDATE ON framework_candidate_assessments
FOR EACH ROW EXECUTE FUNCTION prevent_framework_assessment_mutation();
