ALTER TABLE framework_registrations
  DROP CONSTRAINT framework_registration_pinned_version_check,
  DROP CONSTRAINT framework_registration_pinned_commit_check;

ALTER TABLE framework_registrations
  ADD CONSTRAINT framework_registration_pinned_version_check
    CHECK (adapter_id <> 'hermes-control/v1' OR framework_version = '0.18.0'),
  ADD CONSTRAINT framework_registration_pinned_commit_check
    CHECK (adapter_id <> 'hermes-control/v1' OR framework_commit = '9e54eee44f1cbbe62247a36546e51ff8940373c6');
