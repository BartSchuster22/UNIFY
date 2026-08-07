ALTER TABLE framework_registrations
  DROP CONSTRAINT framework_registration_pinned_version_check,
  DROP CONSTRAINT framework_registration_pinned_commit_check;

UPDATE framework_registrations
SET framework_version = '0.20.0',
    framework_commit = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
    status = 'unavailable',
    verified_at = NULL
WHERE adapter_id = 'hermes-control/v1';

ALTER TABLE framework_registrations
  ADD CONSTRAINT framework_registration_pinned_version_check
    CHECK (adapter_id <> 'hermes-control/v1' OR framework_version = '0.20.0'),
  ADD CONSTRAINT framework_registration_pinned_commit_check
    CHECK (adapter_id <> 'hermes-control/v1' OR framework_commit = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4');
