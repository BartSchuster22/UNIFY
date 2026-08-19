import { spawnSync } from 'node:child_process';

export const LIVE_IDENTITY_INVENTORY_SCHEMA = 'alica-live-identity-inventory/v1';
export const APPROVED_DATASOURCE = Object.freeze({
  composeProject: 'unify',
  composeService: 'postgres',
  containerName: 'unify-postgres-1',
  databaseName: 'unify',
  databaseUser: 'unify',
});

export const INVENTORY_SQL = String.raw`
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
  'schemaVersion', '${LIVE_IDENTITY_INVENTORY_SCHEMA}',
  'operation', 'redacted-row-validation-inventory',
  'transaction', json_build_object(
    'readOnly', current_setting('transaction_read_only') = 'on',
    'isolation', current_setting('transaction_isolation'),
    'transactionIdAssigned', txid_current_if_assigned() IS NOT NULL
  ),
  'counts', json_build_object(
    'users', (SELECT count(*) FROM public.users),
    'activeUsers', (SELECT count(*) FROM public.users WHERE status = 'active'),
    'roles', (SELECT count(*) FROM public.roles),
    'permissions', (SELECT count(*) FROM public.permissions),
    'userRoleBindings', (SELECT count(*) FROM public.user_roles),
    'rolePermissionBindings', (SELECT count(*) FROM public.role_permissions),
    'sessions', (SELECT count(*) FROM public.sessions),
    'activeSessions', (SELECT count(*) FROM public.sessions WHERE revoked_at IS NULL AND expires_at > now()),
    'revokedSessions', (SELECT count(*) FROM public.sessions WHERE revoked_at IS NOT NULL),
    'refreshTokens', (SELECT count(*) FROM public.refresh_tokens),
    'activeRefreshTokens', (SELECT count(*) FROM public.refresh_tokens WHERE revoked_at IS NULL AND expires_at > now()),
    'credentialRevocations', (SELECT count(*) FROM public.credential_revocations),
    'applicationRegistrations', (SELECT count(*) FROM public.application_registrations),
    'enabledApplications', (SELECT count(*) FROM public.application_registrations WHERE enabled),
    'frameworkRegistrations', (SELECT count(*) FROM public.framework_registrations),
    'enabledFrameworkRegistrations', (SELECT count(*) FROM public.framework_registrations WHERE enabled)
  ),
  'rowValidation', json_build_object(
    'users', json_build_object(
      'rowsChecked', (SELECT count(*) FROM public.users),
      'invalidStatusRows', (SELECT count(*) FROM public.users WHERE status NOT IN ('active','disabled','locked'))
    ),
    'sessions', json_build_object(
      'rowsChecked', (SELECT count(*) FROM public.sessions),
      'orphanUserRows', (SELECT count(*) FROM public.sessions s LEFT JOIN public.users u ON u.id=s.user_id WHERE u.id IS NULL),
      'invalidTemporalRows', (SELECT count(*) FROM public.sessions WHERE expires_at < created_at)
    ),
    'userRoleBindings', json_build_object(
      'rowsChecked', (SELECT count(*) FROM public.user_roles),
      'orphanRows', (
        SELECT count(*) FROM public.user_roles ur
        LEFT JOIN public.users u ON u.id=ur.user_id
        LEFT JOIN public.roles r ON r.id=ur.role_id
        WHERE u.id IS NULL OR r.id IS NULL
      )
    ),
    'rolePermissionBindings', json_build_object(
      'rowsChecked', (SELECT count(*) FROM public.role_permissions),
      'orphanRows', (
        SELECT count(*) FROM public.role_permissions rp
        LEFT JOIN public.roles r ON r.id=rp.role_id
        LEFT JOIN public.permissions p ON p.id=rp.permission_id
        WHERE r.id IS NULL OR p.id IS NULL
      )
    ),
    'refreshTokens', json_build_object(
      'rowsChecked', (SELECT count(*) FROM public.refresh_tokens),
      'orphanUserRows', (SELECT count(*) FROM public.refresh_tokens t LEFT JOIN public.users u ON u.id=t.user_id WHERE u.id IS NULL)
    ),
    'applicationRegistrations', json_build_object(
      'rowsChecked', (SELECT count(*) FROM public.application_registrations),
      'missingRequiredRows', (SELECT count(*) FROM public.application_registrations WHERE id IS NULL OR name IS NULL OR client_type IS NULL)
    )
  ),
  'legacyScopeCoverage', json_build_object(
    'frameworkScopedRoleBindings', (SELECT count(*) FROM public.user_roles WHERE framework_scope IS NOT NULL),
    'resourceScopedRoleBindings', (SELECT count(*) FROM public.user_roles WHERE resource_scope IS NOT NULL),
    'unscopedRoleBindings', (SELECT count(*) FROM public.user_roles WHERE framework_scope IS NULL AND resource_scope IS NULL)
  ),
  'targetStructures', json_build_object(
    'tenants', to_regclass('public.tenants') IS NOT NULL,
    'principals', to_regclass('public.principals') IS NOT NULL,
    'principalAliases', to_regclass('public.principal_aliases') IS NOT NULL,
    'externalIdentityBindings', to_regclass('public.external_identity_bindings') IS NOT NULL,
    'tenantMemberships', to_regclass('public.tenant_memberships') IS NOT NULL,
    'applicationGrants', to_regclass('public.application_grants') IS NOT NULL,
    'managedProjections', to_regclass('public.managed_identity_projections') IS NOT NULL,
    'explicitDenies', to_regclass('public.authorization_denies') IS NOT NULL
  ),
  'redaction', json_build_object(
    'identifiersEmitted', false,
    'usernamesEmitted', false,
    'credentialMaterialEmitted', false,
    'connectionDetailsEmitted', false
  ),
  'mutationPerformed', false
)::text;
ROLLBACK;
`;

function runDocker(args, label) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').at(-1);
    throw new Error(`${label}: ${detail || `exit ${result.status}`}`);
  }
  return result.stdout.trim();
}

function inspectContainer(containerName) {
  const raw = runDocker(['inspect', containerName], 'datasource inspection');
  const [container] = JSON.parse(raw);
  if (!container || container.State?.Running !== true) {
    throw new Error('approved datasource container is not running');
  }
  const labels = container.Config?.Labels ?? {};
  if (
    labels['com.docker.compose.project'] !== APPROVED_DATASOURCE.composeProject ||
    labels['com.docker.compose.service'] !== APPROVED_DATASOURCE.composeService
  ) {
    throw new Error('container does not match approved Compose datasource identity');
  }
  return {
    composeProject: labels['com.docker.compose.project'],
    composeService: labels['com.docker.compose.service'],
    containerName,
    containerId: String(container.Id).slice(0, 12),
    imageId: container.Image,
  };
}

export function inventoryLiveIdentityContext({
  containerName = APPROVED_DATASOURCE.containerName,
} = {}) {
  if (containerName !== APPROVED_DATASOURCE.containerName) {
    throw new Error(`unapproved datasource container: ${containerName}`);
  }
  const datasource = inspectContainer(containerName);
  const output = runDocker(
    [
      'exec',
      containerName,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      APPROVED_DATASOURCE.databaseUser,
      '-d',
      APPROVED_DATASOURCE.databaseName,
      '-Atq',
      '-c',
      INVENTORY_SQL,
    ],
    'read-only identity inventory',
  );
  const report = JSON.parse(output.split('\n').find((line) => line.startsWith('{')) ?? '');
  if (report.transaction?.readOnly !== true || report.mutationPerformed !== false) {
    throw new Error('database did not prove a non-mutating read-only transaction');
  }
  return {
    ...report,
    datasource: {
      ...datasource,
      authority: 'live UNIFY Gateway datastore',
      approvedUse: 'redacted row-validation identity/session/grant inventory only',
    },
  };
}
