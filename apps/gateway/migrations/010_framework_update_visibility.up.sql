CREATE TABLE framework_deployments (
  framework_id text PRIMARY KEY REFERENCES framework_registrations(id) ON DELETE CASCADE,
  release_id text NOT NULL CHECK (length(release_id) BETWEEN 1 AND 200),
  image_reference text NOT NULL CHECK (length(image_reference) BETWEEN 1 AND 1000),
  image_digest text NOT NULL CHECK (image_digest ~ '^sha256:[a-f0-9]{64}$'),
  framework_version text NOT NULL CHECK (length(framework_version) BETWEEN 1 AND 100),
  framework_commit text NOT NULL CHECK (framework_commit ~ '^[a-f0-9]{40}$'),
  metadata_source text NOT NULL DEFAULT 'deployment-environment'
    CHECK (metadata_source = 'deployment-environment'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE framework_update_sources (
  source_id text PRIMARY KEY CHECK (source_id ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  repository text NOT NULL UNIQUE CHECK (repository ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  trusted boolean NOT NULL DEFAULT true CHECK (trusted),
  last_checked_at timestamptz,
  last_success_at timestamptz,
  safe_error text CHECK (safe_error IS NULL OR length(safe_error) BETWEEN 1 AND 500),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE framework_update_candidates (
  candidate_id text PRIMARY KEY CHECK (candidate_id ~ '^fuc_[a-f0-9]{64}$'),
  source_id text NOT NULL REFERENCES framework_update_sources(source_id) ON DELETE RESTRICT,
  tag_name text NOT NULL CHECK (length(tag_name) BETWEEN 1 AND 200),
  release_name text NOT NULL CHECK (length(release_name) BETWEEN 1 AND 500),
  commit_sha text NOT NULL CHECK (commit_sha ~ '^[a-f0-9]{40}$'),
  release_url text NOT NULL CHECK (release_url ~ '^https://github\.com/'),
  release_notes text NOT NULL CHECK (length(release_notes) <= 100000),
  published_at timestamptz NOT NULL,
  prerelease boolean NOT NULL,
  draft boolean NOT NULL,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, tag_name)
);
CREATE INDEX framework_update_candidates_latest
  ON framework_update_candidates(source_id, published_at DESC);

CREATE TABLE framework_update_comparisons (
  framework_id text NOT NULL REFERENCES framework_registrations(id) ON DELETE CASCADE,
  candidate_id text NOT NULL REFERENCES framework_update_candidates(candidate_id) ON DELETE CASCADE,
  relation text NOT NULL CHECK (relation IN ('current','update_available','installed_ahead','diverged','unknown')),
  github_status text NOT NULL CHECK (github_status IN ('identical','behind','ahead','diverged','unknown')),
  ahead_by integer NOT NULL DEFAULT 0 CHECK (ahead_by >= 0),
  behind_by integer NOT NULL DEFAULT 0 CHECK (behind_by >= 0),
  checked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (framework_id, candidate_id)
);
