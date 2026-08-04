import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { Pool } from 'pg';
import { ulid } from 'ulid';
import { DEFAULT_AUTHENTICATION_POLICY } from './config.js';
import { PasswordHasher, PRODUCTION_ARGON2ID_POLICY, totpCode } from './crypto.js';
import { CSRF_COOKIE, SESSION_COOKIE, authenticationHttpPlugin } from './http.js';
import { AuthenticationService } from './service.js';
import { AuthenticationError, type AuthenticationConfig, type RequestContext } from './types.js';
import { migrateDatabase, verifyDatabase } from '../database/migrations.js';

const integrationUrl = process.env.CORE_AUTH_TEST_DATABASE_URL;
const bootstrapToken = 'phase-four-bootstrap-token-with-at-least-thirty-two-bytes';
const adminPassword = 'Control-Plane-Initial-2026!';
const operatorPassword = 'Secure-Access-Initial-2026!';
const changedOperatorPassword = 'Secure-Access-Changed-2026!';
const context: RequestContext = {
  remoteAddress: '192.0.2.42',
  userAgent: 'core-auth-integration-test',
  deviceLabel: 'integration',
};

function id(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

function rejectsWith(code: string): (error: unknown) => boolean {
  return (error: unknown) => error instanceof AuthenticationError && error.code === code;
}

function cookiesFrom(response: {
  headers: Record<string, string | string[] | number | undefined>;
}): Map<string, { value: string; attributes: string }> {
  const raw = response.headers['set-cookie'];
  const lines = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const cookies = new Map<string, { value: string; attributes: string }>();
  for (const line of lines) {
    const [pair] = line.split(';', 1);
    const separator = pair!.indexOf('=');
    cookies.set(pair!.slice(0, separator), {
      value: decodeURIComponent(pair!.slice(separator + 1)),
      attributes: line,
    });
  }
  return cookies;
}

test(
  'authentication system enforces bootstrap, sessions, locking, MFA, RBAC, credentials, CSRF, and audit integrity',
  { skip: !integrationUrl },
  async () => {
    const parsed = new URL(integrationUrl!);
    assert.match(
      parsed.pathname,
      /^\/unify_core_auth_test(?:_|$)/,
      'authentication integration database name must start with unify_core_auth_test',
    );
    const pool = new Pool({ connectionString: integrationUrl, max: 8 });
    let now = new Date();
    const config: AuthenticationConfig = {
      passwordPepper: 'phase-four-password-pepper-at-least-thirty-two-bytes',
      tokenPepper: 'phase-four-token-pepper-at-least-thirty-two-bytes',
      mfaEncryptionKeys: new Map([[1, Buffer.alloc(32, 23)]]),
      activeMfaKeyVersion: 1,
      bootstrapToken,
      issuer: 'UNIFY Core Test',
      policy: {
        ...DEFAULT_AUTHENTICATION_POLICY,
        argon2id: { ...PRODUCTION_ARGON2ID_POLICY, memoryCostKiB: 8_192, timeCost: 2 },
        throttleWindowSeconds: 60,
        throttleBlockSeconds: 60,
        pairFailureThreshold: 3,
        identityFailureThreshold: 3,
        networkFailureThreshold: 100,
        accountLockFailureThreshold: 3,
        accountLockMs: 60_000,
        maxSessionsPerIdentity: 3,
      },
    };
    const app = Fastify({ logger: false, trustProxy: false });

    try {
      await pool.query('DROP SCHEMA IF EXISTS core CASCADE');
      const migrated = await migrateDatabase(pool);
      assert.deepEqual(migrated.applied, [1, 2, 3, 4, 5, 6, 7]);
      const service = await AuthenticationService.create(pool, config, () => new Date(now));

      await assert.rejects(
        service.bootstrapAdministrator(
          {
            token: 'wrong-bootstrap-token-that-is-still-long-enough',
            username: 'administrator',
            displayName: 'Administrator',
            password: adminPassword,
          },
          context,
        ),
        rejectsWith('AUTH_BOOTSTRAP_DENIED'),
      );
      const bootstrapped = await service.bootstrapAdministrator(
        {
          token: bootstrapToken,
          username: 'administrator',
          displayName: 'Administrator',
          password: adminPassword,
        },
        context,
      );
      assert.match(bootstrapped.id, /^usr_/);
      assert.ok(bootstrapped.roles.includes('core.admin'));
      assert.ok(bootstrapped.permissions.includes('authorization.manage'));
      await assert.rejects(
        service.bootstrapAdministrator(
          {
            token: bootstrapToken,
            username: 'second-admin',
            displayName: 'Second',
            password: 'Different-Control-2026!',
          },
          context,
        ),
        rejectsWith('AUTH_BOOTSTRAP_COMPLETE'),
      );
      const storedPassword = await pool.query<{ password_hash: string }>(
        'SELECT password_hash FROM core.identities WHERE id=$1',
        [bootstrapped.id],
      );
      assert.match(storedPassword.rows[0]!.password_hash, /^\$argon2id\$v=19\$/);
      assert.equal(storedPassword.rows[0]!.password_hash.includes(adminPassword), false);

      await assert.rejects(
        service.login(
          { username: 'administrator', password: 'Wrong-Administrator-2026!' },
          context,
        ),
        rejectsWith('AUTH_INVALID_CREDENTIALS'),
      );
      const adminLogin = await service.login(
        { username: 'administrator', password: adminPassword },
        context,
      );
      const adminSession = await service.authenticateSession(adminLogin.sessionToken);
      service.verifyCsrf(adminSession, adminLogin.csrfToken, adminLogin.csrfToken);
      assert.throws(
        () => service.verifyCsrf(adminSession, 'wrong', adminLogin.csrfToken),
        rejectsWith('CSRF_INVALID'),
      );
      await assert.rejects(
        service.authorize(
          { ...adminSession },
          'authorization.manage',
          { kind: 'global', id: 'global' },
          context,
        ),
        rejectsWith('AUTH_REQUIRED'),
      );

      const secondAdminLogin = await service.login(
        { username: 'administrator', password: adminPassword },
        { ...context, deviceLabel: 'second-admin-session' },
      );
      await service.revokeSession(
        secondAdminLogin.principal,
        adminLogin.principal.sessionId,
        context,
      );
      await assert.rejects(
        service.authenticateSession(adminLogin.sessionToken),
        rejectsWith('AUTH_REQUIRED'),
      );
      await assert.rejects(service.listSessions(adminSession), rejectsWith('AUTH_REQUIRED'));
      const activeAdmin = await service.authenticateSession(secondAdminLogin.sessionToken);

      const passwordHasher = new PasswordHasher(config.passwordPepper, config.policy.argon2id);
      const operatorId = id('usr');
      await pool.query(
        "INSERT INTO core.identities (id,username,display_name,password_hash,password_changed_at) VALUES ($1,'operator','Operator',$2,$3)",
        [operatorId, await passwordHasher.hash(operatorPassword), now],
      );
      await service.grantRole(
        activeAdmin,
        { kind: 'user', id: operatorId },
        'core.viewer',
        { kind: 'global', id: 'global' },
        undefined,
        context,
      );

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await assert.rejects(
          service.login(
            { username: 'operator', password: 'Wrong-Operator-Password-2026!' },
            context,
          ),
          rejectsWith('AUTH_INVALID_CREDENTIALS'),
        );
      }
      const locked = await pool.query<{
        status: string;
        failed_login_count: number;
        locked_until: Date | null;
      }>('SELECT status,failed_login_count,locked_until FROM core.identities WHERE id=$1', [
        operatorId,
      ]);
      assert.equal(locked.rows[0]!.status, 'locked');
      assert.equal(locked.rows[0]!.failed_login_count, 3);
      assert.ok(locked.rows[0]!.locked_until);
      await assert.rejects(
        service.login({ username: 'operator', password: operatorPassword }, context),
        rejectsWith('AUTH_RATE_LIMITED'),
      );
      await service.unlockIdentity(activeAdmin, operatorId, context);
      now = new Date(now.getTime() + 120_000);

      const operatorLogin = await service.login(
        { username: 'operator', password: operatorPassword },
        context,
      );
      const operatorSession = await service.authenticateSession(operatorLogin.sessionToken);
      await service.changePassword(
        operatorSession,
        {
          currentPassword: operatorPassword,
          newPassword: changedOperatorPassword,
          revokeOtherSessions: true,
        },
        context,
      );
      await assert.rejects(
        service.login({ username: 'operator', password: operatorPassword }, context),
        rejectsWith('AUTH_INVALID_CREDENTIALS'),
      );
      const changedLogin = await service.login(
        { username: 'operator', password: changedOperatorPassword },
        context,
      );
      const changedSession = await service.authenticateSession(changedLogin.sessionToken);
      await assert.rejects(
        service.changePassword(
          changedSession,
          {
            currentPassword: changedOperatorPassword,
            newPassword: operatorPassword,
            revokeOtherSessions: true,
          },
          context,
        ),
        rejectsWith('AUTH_PASSWORD_REUSED'),
      );

      const enrollment = await service.startMfaEnrollment(
        changedSession,
        changedOperatorPassword,
        context,
      );
      assert.equal(enrollment.recoveryCodes.length, 10);
      assert.equal(JSON.stringify(enrollment).includes(changedOperatorPassword), false);
      const provisioning = new URL(enrollment.provisioningUri);
      const mfaSecret = provisioning.searchParams.get('secret');
      assert.ok(mfaSecret);
      const confirmationCode = totpCode(mfaSecret, now);
      await service.confirmMfaEnrollment(
        changedSession,
        enrollment.enrollmentId,
        confirmationCode,
        context,
      );
      const confirmedSession = await service.authenticateSession(changedLogin.sessionToken);
      assert.equal(confirmedSession.mfaVerified, true);
      await assert.rejects(
        service.login({ username: 'operator', password: changedOperatorPassword }, context),
        rejectsWith('AUTH_MFA_REQUIRED'),
      );
      await assert.rejects(
        service.login(
          { username: 'operator', password: changedOperatorPassword, mfaCode: confirmationCode },
          context,
        ),
        rejectsWith('AUTH_MFA_INVALID'),
      );
      now = new Date(now.getTime() + 31_000);
      const mfaLogin = await service.login(
        {
          username: 'operator',
          password: changedOperatorPassword,
          mfaCode: totpCode(mfaSecret, now),
        },
        context,
      );
      assert.equal(mfaLogin.principal.mfaVerified, true);
      const recoveryLogin = await service.login(
        {
          username: 'operator',
          password: changedOperatorPassword,
          mfaCode: enrollment.recoveryCodes[0]!,
        },
        context,
      );
      assert.equal(recoveryLogin.principal.mfaVerified, true);
      await assert.rejects(
        service.login(
          {
            username: 'operator',
            password: changedOperatorPassword,
            mfaCode: enrollment.recoveryCodes[0]!,
          },
          context,
        ),
        rejectsWith('AUTH_MFA_INVALID'),
      );

      const frameworkOne = id('frm');
      const frameworkTwo = id('frm');
      const serviceId = await service.createServicePrincipal(
        activeAdmin,
        'phase-four-framework-agent',
        context,
      );
      await service.grantRole(
        activeAdmin,
        { kind: 'service', id: serviceId },
        'core.operator',
        { kind: 'framework', id: frameworkOne },
        undefined,
        context,
      );
      const issued = await service.issueServiceCredential(
        activeAdmin,
        { serviceId, label: 'framework credential', scopes: ['frameworks.*'] },
        context,
      );
      assert.match(issued.token, /^crd_[0-9A-HJKMNP-TV-Z]{26}\.[A-Za-z0-9_-]{43}$/);
      const servicePrincipal = await service.authenticateService(issued.token, context);
      await service.authorize(
        servicePrincipal,
        'frameworks.manage',
        { kind: 'framework', id: frameworkOne },
        context,
      );
      await assert.rejects(
        service.authorize(
          servicePrincipal,
          'frameworks.manage',
          { kind: 'framework', id: frameworkTwo },
          context,
        ),
        rejectsWith('AUTH_FORBIDDEN'),
      );
      await assert.rejects(
        service.authorize(
          servicePrincipal,
          'models.manage',
          { kind: 'framework', id: frameworkOne },
          context,
        ),
        rejectsWith('AUTH_FORBIDDEN'),
      );

      await app.register(authenticationHttpPlugin, { service, secureCookies: false });
      const bearerAuthorization = await app.inject({
        method: 'GET',
        url: '/core/v1/identity/service-credentials',
        headers: { authorization: `Bearer ${issued.token}` },
      });
      assert.equal(bearerAuthorization.statusCode, 403);
      assert.equal(bearerAuthorization.json().error.code, 'authorization_denied');
      await service.revokeServiceCredential(activeAdmin, issued.credential.id, context);
      await assert.rejects(
        service.authenticateService(issued.token, context),
        rejectsWith('AUTH_REQUIRED'),
      );
      await assert.rejects(
        service.authorize(
          servicePrincipal,
          'frameworks.manage',
          { kind: 'framework', id: frameworkOne },
          context,
        ),
        rejectsWith('AUTH_REQUIRED'),
      );

      const suppliedRequestId = 'req_01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const suppliedCorrelationId = 'cor_01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const unknownField = await app.inject({
        method: 'POST',
        url: '/core/v1/identity/login',
        headers: { 'x-request-id': suppliedRequestId, 'x-correlation-id': suppliedCorrelationId },
        payload: { username: 'administrator', password: adminPassword, unexpected: true },
      });
      assert.equal(unknownField.statusCode, 422);
      assert.equal(unknownField.json().error.requestId, suppliedRequestId);
      assert.equal(unknownField.json().error.correlationId, suppliedCorrelationId);
      const httpLogin = await app.inject({
        method: 'POST',
        url: '/core/v1/identity/login',
        headers: { 'user-agent': 'http-integration' },
        payload: { username: 'administrator', password: adminPassword },
      });
      assert.equal(httpLogin.statusCode, 200);
      const cookies = cookiesFrom(httpLogin);
      const sessionCookie = cookies.get(SESSION_COOKIE);
      const csrfCookie = cookies.get(CSRF_COOKIE);
      assert.ok(sessionCookie);
      assert.ok(csrfCookie);
      assert.match(sessionCookie.attributes, /HttpOnly/i);
      assert.match(sessionCookie.attributes, /SameSite=Strict/i);
      assert.doesNotMatch(csrfCookie.attributes, /HttpOnly/i);
      const cookieHeader = `${SESSION_COOKIE}=${sessionCookie.value}; ${CSRF_COOKIE}=${csrfCookie.value}`;
      const principalResponse = await app.inject({
        method: 'GET',
        url: '/core/v1/identity/principal',
        headers: { cookie: cookieHeader },
      });
      assert.equal(principalResponse.statusCode, 200);
      assert.equal(principalResponse.json().contractVersion, 'core.v1');
      const csrfDenied = await app.inject({
        method: 'POST',
        url: '/core/v1/identity/logout',
        headers: { cookie: cookieHeader },
      });
      assert.equal(csrfDenied.statusCode, 403);
      assert.equal(csrfDenied.json().error.code, 'csrf_failed');
      const logout = await app.inject({
        method: 'POST',
        url: '/core/v1/identity/logout',
        headers: { cookie: cookieHeader, 'x-csrf-token': csrfCookie.value },
      });
      assert.equal(logout.statusCode, 204);
      await assert.rejects(
        service.authenticateSession(sessionCookie.value),
        rejectsWith('AUTH_REQUIRED'),
      );

      const auditVerification = await pool.query<{ violations: string }>(
        'SELECT count(*)::text AS violations FROM core.verify_audit_chain()',
      );
      assert.equal(auditVerification.rows[0]!.violations, '0');
      const audit = await pool.query<{ count: string; details: string }>(
        "SELECT count(*)::text AS count, string_agg(details::text, ' ') AS details FROM core.audit_records",
      );
      assert.ok(Number(audit.rows[0]!.count) >= 20);
      const serializedAudit = audit.rows[0]!.details;
      for (const secret of [
        bootstrapToken,
        adminPassword,
        operatorPassword,
        changedOperatorPassword,
        issued.token,
        enrollment.recoveryCodes[0]!,
        mfaSecret,
      ]) {
        assert.equal(
          serializedAudit.includes(secret),
          false,
          'authentication audit must not contain secrets',
        );
      }
      const actions = await pool.query<{ action: string }>(
        'SELECT DISTINCT action FROM core.audit_records ORDER BY action',
      );
      const actionSet = new Set(actions.rows.map((row) => row.action));
      for (const required of [
        'identity.bootstrap.succeeded',
        'identity.login.denied',
        'identity.login.succeeded',
        'identity.login.throttled',
        'identity.password.changed',
        'identity.mfa.enabled',
        'identity.service-credential.issued',
        'identity.service-authentication.succeeded',
        'authorization.role.granted',
        'authorization.denied',
      ])
        assert.ok(actionSet.has(required), `missing audit action ${required}`);
      await verifyDatabase(pool);
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
