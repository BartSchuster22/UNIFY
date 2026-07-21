ALTER TABLE framework_registrations
  DROP CONSTRAINT IF EXISTS framework_registration_auth_reference_check,
  DROP CONSTRAINT IF EXISTS framework_registration_status_check,
  DROP CONSTRAINT IF EXISTS framework_registration_scopes_check,
  DROP CONSTRAINT IF EXISTS framework_registration_pinned_commit_check,
  DROP CONSTRAINT IF EXISTS framework_registration_pinned_version_check,
  DROP CONSTRAINT IF EXISTS framework_registration_commit_check,
  DROP CONSTRAINT IF EXISTS framework_registration_contract_check,
  DROP COLUMN IF EXISTS verified_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS framework_commit,
  DROP COLUMN IF EXISTS framework_version,
  DROP COLUMN IF EXISTS contract_version,
  DROP COLUMN IF EXISTS scopes;
