ALTER TABLE framework_registrations
  ADD COLUMN scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN contract_version text,
  ADD COLUMN framework_version text,
  ADD COLUMN framework_commit text,
  ADD COLUMN status text NOT NULL DEFAULT 'unavailable',
  ADD COLUMN verified_at timestamptz;

ALTER TABLE framework_registrations
  ADD CONSTRAINT framework_registration_contract_check
    CHECK (adapter_id <> 'hermes-control/v1' OR contract_version = 'hermes-control/v1'),
  ADD CONSTRAINT framework_registration_commit_check
    CHECK (framework_commit IS NULL OR framework_commit ~ '^[a-f0-9]{40}$'),
  ADD CONSTRAINT framework_registration_pinned_version_check
    CHECK (adapter_id <> 'hermes-control/v1' OR framework_version = '0.18.0'),
  ADD CONSTRAINT framework_registration_pinned_commit_check
    CHECK (adapter_id <> 'hermes-control/v1' OR framework_commit = '9e54eee44f1cbbe62247a36546e51ff8940373c6'),
  ADD CONSTRAINT framework_registration_scopes_check
    CHECK (adapter_id <> 'hermes-control/v1' OR cardinality(scopes) > 0),
  ADD CONSTRAINT framework_registration_status_check
    CHECK (status IN ('verified','disabled','unavailable','unsupported')),
  ADD CONSTRAINT framework_registration_auth_reference_check
    CHECK (adapter_id <> 'hermes-control/v1' OR secret_reference ~ '^env:[A-Z][A-Z0-9_]{2,127}$');
