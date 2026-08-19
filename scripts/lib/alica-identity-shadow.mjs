import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const IDENTITY_SHADOW_CONTRACT = 'alica-identity-shadow/v0.1';
export const INVENTORY_SCHEMA = 'alica-identity-context-inventory/v1';
export const DECISION_SCHEMA = 'alica-authorization-shadow-decision/v1';

const REQUIRED_SOURCES = Object.freeze({
  runtimeImage: 'Dockerfile.gateway',
  runtimeCompose: 'deploy/five-service/compose.yaml',
  gatewayRoutes: 'apps/gateway/src/app.ts',
  gatewayAuthService: 'apps/gateway/src/auth/service.ts',
  gatewayAuthTypes: 'apps/gateway/src/auth/types.ts',
  gatewayAuthStore: 'apps/gateway/src/auth/postgres-store.ts',
  gatewayFoundation: 'apps/gateway/migrations/001_gateway_foundation.up.sql',
  coreAuthService: 'apps/core/src/auth/service.ts',
  coreAuthTypes: 'apps/core/src/auth/types.ts',
  coreIdentitySchema: 'apps/core/migrations/002_identity_authorization.sql',
  coreSessionSchema: 'apps/core/migrations/006_authentication_runtime.sql',
});

const REQUIRED_MARKERS = Object.freeze({
  runtimeImage: ['COPY apps/gateway apps/gateway', 'CMD ["dist/server.js"]'],
  runtimeCompose: ['unify-core:', 'UNIFY_CORE_IMAGE'],
  gatewayRoutes: ['auth.requirePermission(current,', '/api/v1/auth/login'],
  gatewayAuthService: [
    'requirePermission(principal:',
    'principal.permissions.includes(permission)',
  ],
  gatewayAuthTypes: ['export interface PrincipalRecord', 'permissions: string[]'],
  gatewayAuthStore: ['class PostgresAuthStore', 'LEFT JOIN role_permissions'],
  gatewayFoundation: ['CREATE TABLE users', 'CREATE TABLE application_registrations'],
  coreAuthService: ['async authorize(', 'core.authorization_bindings'],
  coreAuthTypes: ["export type ScopeKind = 'global'", 'export type AuthenticatedPrincipal'],
  coreIdentitySchema: ['CREATE TABLE core.identities', 'core.authorization_bindings'],
  coreSessionSchema: ['ALTER TABLE core.identity_sessions', 'authentication_method'],
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stable(value));
}

function inside(root, path) {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, path);
  const rel = relative(resolvedRoot, resolvedPath);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`Unsafe or empty inventory path: ${path}`);
  }
  return resolvedPath;
}

function source(root, name, relativePath) {
  const path = inside(root, relativePath);
  const content = readFileSync(path, 'utf8');
  for (const marker of REQUIRED_MARKERS[name]) {
    if (!content.includes(marker)) throw new Error(`Required ${name} marker is absent: ${marker}`);
  }
  return { path: relativePath, content, sha256: sha256(content) };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function tableNames(sql) {
  return sortedUnique(
    [...sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+(?:\.[a-z_]+)?)/gu)].map(
      (match) => match[1],
    ),
  );
}

function permissionCalls(sourceText) {
  return [...sourceText.matchAll(/auth\.requirePermission\(current,\s*([^;\n]+)\);/gu)].map(
    (match) => {
      const expression = match[1].trim();
      const literal = /^'([a-z][a-z0-9._:-]+)'$/u.exec(expression);
      const before = sourceText.slice(0, match.index);
      return {
        line: before.split('\n').length,
        kind: literal ? 'literal' : 'dynamic',
        expression: literal?.[1] ?? expression,
      };
    },
  );
}

/** Read-only source/schema inventory. This function performs no database, network or write operation. */
export function inspectIdentityAuthorizationContext(root) {
  const sources = Object.fromEntries(
    Object.entries(REQUIRED_SOURCES).map(([name, path]) => [name, source(root, name, path)]),
  );
  const calls = permissionCalls(sources.gatewayRoutes.content);
  const staticPermissions = sortedUnique(
    calls.filter((call) => call.kind === 'literal').map((call) => call.expression),
  );
  const sourceDigests = Object.fromEntries(
    Object.entries(sources).map(([name, item]) => [name, { path: item.path, sha256: item.sha256 }]),
  );
  const sourceVersion = `sha256:${sha256(stableJson(sourceDigests))}`;

  return {
    schemaVersion: INVENTORY_SCHEMA,
    contractVersion: IDENTITY_SHADOW_CONTRACT,
    operation: 'read-only-source-schema-inventory',
    mutationPerformed: false,
    enforcementChanged: false,
    sourceVersion,
    runtime: {
      fiveServiceAuthSurface: 'apps/gateway',
      evidence: [
        'Dockerfile.gateway builds @aquiero/gateway',
        'five-service unify-core uses UNIFY_CORE_IMAGE',
      ],
      successorEvidenceSurface: 'apps/core',
    },
    currentAuthorization: {
      principalKinds: ['user'],
      userIdentityKey: 'gateway users.id uuid',
      authentication: 'local username/password and opaque server-side session',
      roleModel: 'users -> user_roles -> roles -> role_permissions -> permissions',
      decision: 'authenticated active session AND permission array contains required permission',
      routePermissionCalls: calls,
      staticPermissions,
      dynamicPermissionCallCount: calls.filter((call) => call.kind === 'dynamic').length,
      gatewayTables: tableNames(sources.gatewayFoundation.content),
      successorScopeKinds: ['global', 'framework', 'profile', 'project'],
      successorPrincipalKinds: ['user', 'service'],
    },
    targetContext: {
      principalBinding: {
        state: 'absent',
        evidence: 'no canonical prn_ alias/binding in runtime auth schema',
      },
      tenant: {
        state: 'absent',
        evidence:
          'no tenant or membership context in runtime principal/session/permission decision',
      },
      applicationClient: {
        state: 'catalog-only-not-bound',
        evidence:
          'application_registrations exists but session and requirePermission do not bind a client or grant',
      },
      resourceTenant: {
        state: 'absent',
        evidence: 'permission decision does not compare target tenant ownership',
      },
      managedProjection: {
        state: 'absent',
        evidence: 'no source authority/version/freshness in runtime authorization',
      },
      explicitDeny: {
        state: 'absent',
        evidence: 'current runtime decision is permission membership only',
      },
      decisionEvidence: {
        state: 'partial',
        evidence: 'route errors/audit exist without full target decision record',
      },
    },
    limitations: [
      'Inventory describes checked-in source and schema, not live database rows.',
      'Application registration presence does not prove request-client authorization.',
      'The apps/core successor surface is evidence, not the five-service runtime auth surface.',
      'No shadow result is connected to request execution or response behavior.',
    ],
    sources: sourceDigests,
  };
}

function legacyDecision(input) {
  if (!input.legacy.authenticated) return { effect: 'deny', reasonCode: 'AUTHENTICATION_REQUIRED' };
  if (!input.legacy.principalActive) return { effect: 'deny', reasonCode: 'PRINCIPAL_INACTIVE' };
  if (input.legacy.passwordChangeRequired)
    return { effect: 'deny', reasonCode: 'AUTH_PASSWORD_CHANGE_REQUIRED' };
  if (!input.legacy.permissionGranted) return { effect: 'deny', reasonCode: 'PERMISSION_DENIED' };
  if (!input.legacy.credentialScopeAllowed)
    return { effect: 'deny', reasonCode: 'CREDENTIAL_SCOPE_DENIED' };
  return { effect: 'allow', reasonCode: 'AUTHORIZED' };
}

function shadowDecision(input, legacy) {
  if (legacy.effect === 'deny') return legacy;
  const context = input.target;
  if (!context.canonicalPrincipalId)
    return { effect: 'deny', reasonCode: 'PRINCIPAL_BINDING_MISSING' };
  if (!context.tenant) return { effect: 'deny', reasonCode: 'TENANT_CONTEXT_MISSING' };
  if (context.tenant.status !== 'active') return { effect: 'deny', reasonCode: 'TENANT_INACTIVE' };
  if (input.principalKind === 'user' && context.tenant.membershipStatus !== 'active')
    return { effect: 'deny', reasonCode: 'MEMBERSHIP_INACTIVE' };
  if (!context.application) return { effect: 'deny', reasonCode: 'APPLICATION_UNKNOWN' };
  if (context.application.status !== 'active')
    return { effect: 'deny', reasonCode: 'APPLICATION_INACTIVE' };
  if (!context.application.grantAllows)
    return { effect: 'deny', reasonCode: 'APPLICATION_GRANT_DENIED' };
  if (!context.resource) return { effect: 'deny', reasonCode: 'RESOURCE_CONTEXT_MISSING' };
  if (context.resource.tenantId !== context.tenant.id)
    return { effect: 'deny', reasonCode: 'TENANT_SCOPE_MISMATCH' };
  if (!context.resource.scopeAllows) return { effect: 'deny', reasonCode: 'RESOURCE_SCOPE_DENIED' };
  if (context.explicitDeny) return { effect: 'deny', reasonCode: 'EXPLICIT_DENY' };
  if (context.freshnessRequired && !context.tenant.projectionFresh)
    return { effect: 'deny', reasonCode: 'PROJECTION_STALE' };
  if (!context.authenticationFresh) return { effect: 'deny', reasonCode: 'AUTHENTICATION_STALE' };
  if (!context.authenticationStrongEnough)
    return { effect: 'deny', reasonCode: 'STEP_UP_REQUIRED' };
  if (context.entitlement === 'denied') return { effect: 'deny', reasonCode: 'ENTITLEMENT_DENIED' };
  if (context.entitlement === 'unavailable')
    return { effect: 'deny', reasonCode: 'ENTITLEMENT_UNAVAILABLE' };
  return { effect: 'allow', reasonCode: 'AUTHORIZED' };
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Input must be an object');
  if (!['user', 'service'].includes(input.principalKind)) throw new Error('Invalid principalKind');
  if (!input.legacy || typeof input.legacy !== 'object')
    throw new Error('legacy context is required');
  for (const name of [
    'authenticated',
    'principalActive',
    'passwordChangeRequired',
    'permissionGranted',
    'credentialScopeAllowed',
  ]) {
    if (typeof input.legacy[name] !== 'boolean') throw new Error(`legacy.${name} must be boolean`);
  }
  if (!input.target || typeof input.target !== 'object' || Array.isArray(input.target))
    throw new Error('target context is required');
}

/** Pure evidence-only evaluator. The return value is not an enforcement decision. */
export function evaluateAuthorizationShadow(input) {
  validateInput(input);
  const legacy = legacyDecision(input);
  const shadowTarget = shadowDecision(input, legacy);
  const comparison =
    legacy.effect === shadowTarget.effect
      ? 'matched'
      : legacy.effect === 'allow'
        ? 'tightened'
        : 'widened';
  const evidenceInput = {
    principalKind: input.principalKind,
    legacy: input.legacy,
    target: input.target,
  };
  return {
    schemaVersion: DECISION_SCHEMA,
    contractVersion: IDENTITY_SHADOW_CONTRACT,
    mode: 'shadow-only',
    enforcementApplied: false,
    executionAuthorized: false,
    evidenceId: `sha256:${sha256(stableJson(evidenceInput))}`,
    legacy,
    shadowTarget,
    comparison,
  };
}
