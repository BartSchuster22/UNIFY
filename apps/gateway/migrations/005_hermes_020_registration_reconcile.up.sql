UPDATE framework_registrations
SET framework_version = '0.20.0',
    framework_commit = 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4',
    status = 'unavailable',
    verified_at = NULL
WHERE adapter_id = 'hermes-control/v1'
  AND (framework_version <> '0.20.0'
    OR framework_commit <> 'b8b17b8cee50b85adb7fba6ea332dc06731b86f4');
