import { ulid } from 'ulid';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  PasswordHasher,
  decryptMfaSecret,
  digestSecret,
  encryptMfaSecret,
  formatOpaqueCredential,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  normalizeUsername,
  opaqueSecret,
  parseOpaqueCredential,
  provisioningUri,
  safeEqual,
  safeStringEqual,
  validatePassword,
  verifyTotpCounter,
} from './crypto.js';
import type {
  AuthenticatedPrincipal,
  AuthenticationConfig,
  AuthorizationScope,
  BootstrapInput,
  IssuedServiceCredential,
  LoginInput,
  LoginResult,
  MfaEnrollmentChallenge,
  PasswordChangeInput,
  RequestContext,
  ServiceCredentialInput,
  ServiceCredentialMetadata,
  ServicePrincipal,
  SessionAuthentication,
  SessionSummary,
  UserPrincipal,
} from './types.js';
import { AuthenticationError } from './types.js';

export const AUTHENTICATION_SYSTEM_PRINCIPAL_ID = 'svc_00000000000000000000000001';
const GLOBAL_SCOPE: AuthorizationScope = Object.freeze({ kind: 'global', id: 'global' });
const ID_PATTERN = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u;
const PERMISSION_PATTERN = /^[a-z][a-z0-9._:-]{2,127}$/u;
const SCOPE_PATTERN = /^(?:\*|[a-z][a-z0-9._:-]{2,127}|[a-z][a-z0-9._:-]{1,125}\.\*)$/u;

type Database = Pool | PoolClient;

interface IdentityRow extends QueryResultRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  status: 'active' | 'locked' | 'disabled';
  mfa_enabled: boolean;
  failed_login_count: number;
  locked_until: Date | null;
  require_password_change: boolean;
}

interface MfaRow extends QueryResultRow {
  id: string;
  identity_id: string;
  secret_ciphertext: Buffer;
  secret_key_version: number;
  state: 'pending' | 'active' | 'revoked';
  expires_at: Date;
  last_verified_counter: string | null;
}

interface AuthorizationRows extends QueryResultRow {
  roles: string[];
  permissions: string[];
}

function canonicalId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}

function safeContextIds(context: RequestContext): { requestId: string; correlationId: string } {
  return {
    requestId: context.requestId?.startsWith('req_') ? context.requestId : canonicalId('req'),
    correlationId: context.correlationId?.startsWith('cor_')
      ? context.correlationId
      : canonicalId('cor'),
  };
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function credentialScopeAllows(scopes: readonly string[], permission: string): boolean {
  return scopes.some(
    (scope) =>
      scope === '*' ||
      scope === permission ||
      (scope.endsWith('.*') && permission.startsWith(scope.slice(0, -1))),
  );
}

export class AuthenticationService {
  readonly #pool: Pool;
  readonly #config: AuthenticationConfig;
  readonly #passwords: PasswordHasher;
  readonly #dummyPasswordHash: string;
  readonly #now: () => Date;
  readonly #authenticatedPrincipals = new WeakSet<object>();

  private constructor(
    pool: Pool,
    config: AuthenticationConfig,
    dummyPasswordHash: string,
    now: () => Date,
  ) {
    this.#pool = pool;
    this.#config = config;
    this.#passwords = new PasswordHasher(config.passwordPepper, config.policy.argon2id);
    this.#dummyPasswordHash = dummyPasswordHash;
    this.#now = now;
  }

  static async create(
    pool: Pool,
    config: AuthenticationConfig,
    now: () => Date = () => new Date(),
  ): Promise<AuthenticationService> {
    const passwords = new PasswordHasher(config.passwordPepper, config.policy.argon2id);
    digestSecret('authentication-configuration-check', config.tokenPepper);
    if (config.bootstrapToken && Buffer.byteLength(config.bootstrapToken, 'utf8') < 32)
      throw new Error('Bootstrap token must contain at least 32 bytes');
    const keyRegistry = await pool.query<
      { key_version: number; retired_at: Date | null } & QueryResultRow
    >(
      "SELECT key_version,retired_at FROM core.authentication_key_versions WHERE purpose='mfa-encryption'",
    );
    const active = keyRegistry.rows.find(
      (row) => row.key_version === config.activeMfaKeyVersion && row.retired_at === null,
    );
    if (!active || config.mfaEncryptionKeys.get(config.activeMfaKeyVersion)?.length !== 32) {
      throw new Error('Active MFA encryption key version is not registered and configured');
    }
    const inUse = await pool.query<{ secret_key_version: number } & QueryResultRow>(
      "SELECT DISTINCT secret_key_version FROM core.mfa_enrollments WHERE state IN ('pending','active')",
    );
    if (
      inUse.rows.some((row) => config.mfaEncryptionKeys.get(row.secret_key_version)?.length !== 32)
    ) {
      throw new Error('An active MFA enrollment encryption key is unavailable');
    }
    const dummyPasswordHash = await passwords.hash(`Unusable-${opaqueSecret()}`);
    return new AuthenticationService(pool, config, dummyPasswordHash, now);
  }

  #assertAuthenticated(principal: AuthenticatedPrincipal): void {
    if (!this.#authenticatedPrincipals.has(principal))
      throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
  }

  async #assertPrincipalActive(principal: AuthenticatedPrincipal): Promise<void> {
    this.#assertAuthenticated(principal);
    const result =
      principal.kind === 'user'
        ? await this.#pool.query(
            `SELECT 1 FROM core.identity_sessions session
         JOIN core.identities identity ON identity.id=session.identity_id
         WHERE session.id=$1 AND session.identity_id=$2 AND session.revoked_at IS NULL
           AND session.expires_at>clock_timestamp() AND identity.status='active'`,
            [principal.sessionId, principal.id],
          )
        : await this.#pool.query(
            `SELECT 1 FROM core.service_credentials credential
         JOIN core.service_principals service ON service.id=credential.service_id
         WHERE credential.id=$1 AND credential.service_id=$2 AND credential.revoked_at IS NULL
           AND (credential.expires_at IS NULL OR credential.expires_at>clock_timestamp()) AND service.status='active'`,
            [principal.credentialId, principal.id],
          );
    if (!result.rowCount)
      throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
  }

  #markAuthenticated<T extends AuthenticatedPrincipal>(principal: T): T {
    this.#authenticatedPrincipals.add(principal);
    return principal;
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  #key(version: number): Buffer {
    const key = this.#config.mfaEncryptionKeys.get(version);
    if (!key) throw new AuthenticationError('AUTH_MFA_KEY_UNAVAILABLE', 503, 'MFA key unavailable');
    return key;
  }

  #throttleDigest(
    kind: 'identity' | 'network' | 'identity-network',
    username: string,
    remoteAddress: string,
  ): Buffer {
    const material =
      kind === 'identity'
        ? username
        : kind === 'network'
          ? remoteAddress
          : `${username}\u0000${remoteAddress}`;
    return digestSecret(`auth-throttle:${kind}:${material}`, this.#config.tokenPepper);
  }

  #contextDigest(label: string, value: string): string {
    return digestSecret(`${label}:${value}`, this.#config.tokenPepper).toString('hex');
  }

  async #audit(
    database: Database,
    actor: { kind: 'user' | 'service'; id: string },
    action: string,
    outcome: 'succeeded' | 'denied' | 'failed',
    context: RequestContext,
    resourceKind: string,
    resourceId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    const ids = safeContextIds(context);
    await database.query(
      `INSERT INTO core.audit_records
        (id, actor_kind, actor_id, action, resource_kind, resource_id, request_id, correlation_id, outcome, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        canonicalId('aud'),
        actor.kind,
        actor.id,
        action,
        resourceKind,
        resourceId,
        ids.requestId,
        ids.correlationId,
        outcome,
        JSON.stringify(details),
      ],
    );
  }

  async #authorization(
    database: Database,
    kind: 'user' | 'service',
    id: string,
    scope: AuthorizationScope,
  ): Promise<AuthorizationRows> {
    const result = await database.query<AuthorizationRows>(
      `SELECT
         coalesce(array_agg(DISTINCT binding.role_key) FILTER (WHERE binding.role_key IS NOT NULL), '{}')::text[] AS roles,
         coalesce(array_agg(DISTINCT role_permission.permission_key) FILTER (WHERE role_permission.permission_key IS NOT NULL), '{}')::text[] AS permissions
       FROM core.authorization_bindings binding
       LEFT JOIN core.authorization_role_permissions role_permission ON role_permission.role_key = binding.role_key
       WHERE binding.principal_kind=$1 AND binding.principal_id=$2
         AND (binding.expires_at IS NULL OR binding.expires_at > clock_timestamp())
         AND ((binding.scope_kind='global' AND binding.scope_id='global') OR (binding.scope_kind=$3 AND binding.scope_id=$4))`,
      [kind, id, scope.kind, scope.id],
    );
    return result.rows[0] ?? { roles: [], permissions: [] };
  }

  async authorize(
    principal: AuthenticatedPrincipal,
    permission: string,
    scope: AuthorizationScope = GLOBAL_SCOPE,
    context?: RequestContext,
  ): Promise<void> {
    await this.#assertPrincipalActive(principal);
    if (!PERMISSION_PATTERN.test(permission)) throw new Error('Invalid permission key');
    if (principal.kind === 'user' && principal.passwordChangeRequired) {
      throw new AuthenticationError(
        'AUTH_PASSWORD_CHANGE_REQUIRED',
        403,
        'Password change required',
      );
    }
    const authorization = await this.#authorization(
      this.#pool,
      principal.kind,
      principal.id,
      scope,
    );
    const allowedByRole = authorization.permissions.includes(permission);
    const allowedByCredential =
      principal.kind === 'user' || credentialScopeAllows(principal.credentialScopes, permission);
    if (allowedByRole && allowedByCredential) return;
    await this.#audit(
      this.#pool,
      principal,
      'authorization.denied',
      'denied',
      context ?? { remoteAddress: '0.0.0.0' },
      'authorization',
      principal.id,
      { permission, scopeKind: scope.kind, scopeId: scope.id },
    );
    throw new AuthenticationError('AUTH_FORBIDDEN', 403, 'Forbidden');
  }

  async bootstrapAdministrator(
    input: BootstrapInput,
    context: RequestContext,
  ): Promise<UserPrincipal> {
    const expected = this.#config.bootstrapToken;
    const tokenValid = Boolean(
      expected &&
      Buffer.byteLength(expected, 'utf8') >= 32 &&
      safeStringEqual(input.token, expected),
    );
    if (!tokenValid) {
      await this.#audit(
        this.#pool,
        { kind: 'service', id: AUTHENTICATION_SYSTEM_PRINCIPAL_ID },
        'identity.bootstrap.denied',
        'denied',
        context,
        'identity',
        null,
        {
          remoteAddressDigest: this.#contextDigest('remote', context.remoteAddress),
        },
      );
      throw new AuthenticationError('AUTH_BOOTSTRAP_DENIED', 403, 'Administrator bootstrap denied');
    }
    const username = normalizeUsername(input.username);
    if (!USERNAME_PATTERN.test(input.username) || username !== input.username.toLowerCase()) {
      throw new AuthenticationError('AUTH_USERNAME_INVALID', 422, 'Username does not meet policy');
    }
    if (input.displayName.trim().length < 1 || input.displayName.length > 200) {
      throw new AuthenticationError(
        'AUTH_DISPLAY_NAME_INVALID',
        422,
        'Display name does not meet policy',
      );
    }
    const passwordValidation = validatePassword(input.password, username);
    if (!passwordValidation.valid)
      throw new AuthenticationError('AUTH_PASSWORD_POLICY', 422, 'Password does not meet policy');
    const passwordHash = await this.#passwords.hash(input.password);
    const identityId = canonicalId('usr');

    const completed = await this.#transaction(async (client) => {
      const state = await client.query<{ completed_at: Date | null }>(
        'SELECT completed_at FROM core.authentication_bootstrap WHERE singleton=true FOR UPDATE',
      );
      const identities = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM core.identities',
      );
      if (state.rows[0]?.completed_at || identities.rows[0]?.count !== '0') {
        await this.#audit(
          client,
          { kind: 'service', id: AUTHENTICATION_SYSTEM_PRINCIPAL_ID },
          'identity.bootstrap.denied',
          'denied',
          context,
          'identity',
          null,
          { reason: 'already-completed' },
        );
        return false;
      }
      await client.query(
        'INSERT INTO core.identities (id, username, display_name, password_hash, password_changed_at) VALUES ($1,$2,$3,$4,$5)',
        [identityId, username, input.displayName.trim(), passwordHash, this.#now()],
      );
      await client.query(
        `INSERT INTO core.authorization_bindings
          (principal_kind, principal_id, role_key, scope_kind, scope_id, granted_by_kind, granted_by_id)
         VALUES ('user',$1,'core.admin','global','global','service',$2)`,
        [identityId, AUTHENTICATION_SYSTEM_PRINCIPAL_ID],
      );
      await client.query(
        'UPDATE core.authentication_bootstrap SET completed_at=$1, identity_id=$2 WHERE singleton=true',
        [this.#now(), identityId],
      );
      await this.#audit(
        client,
        { kind: 'service', id: AUTHENTICATION_SYSTEM_PRINCIPAL_ID },
        'identity.bootstrap.succeeded',
        'succeeded',
        context,
        'identity',
        identityId,
        { usernameDigest: this.#contextDigest('username', username) },
      );
      return true;
    });
    if (!completed)
      throw new AuthenticationError(
        'AUTH_BOOTSTRAP_COMPLETE',
        409,
        'Administrator bootstrap is already complete',
      );
    const authorization = await this.#authorization(this.#pool, 'user', identityId, GLOBAL_SCOPE);
    return {
      kind: 'user',
      id: identityId,
      username,
      displayName: input.displayName.trim(),
      roles: uniqueSorted(authorization.roles),
      permissions: uniqueSorted(authorization.permissions),
      mfaVerified: false,
      passwordChangeRequired: false,
      sessionId: '',
    };
  }

  async #blocked(username: string, remoteAddress: string, now: Date): Promise<Date | null> {
    const digests = [
      this.#throttleDigest('identity', username, remoteAddress),
      this.#throttleDigest('network', username, remoteAddress),
      this.#throttleDigest('identity-network', username, remoteAddress),
    ];
    const result = await this.#pool.query<{ blocked_until: Date }>(
      'SELECT max(blocked_until) AS blocked_until FROM core.authentication_throttles WHERE bucket_digest = ANY($1::bytea[]) AND blocked_until > $2',
      [digests, now],
    );
    return result.rows[0]?.blocked_until ?? null;
  }

  async #recordLoginFailure(
    identity: IdentityRow | null,
    username: string,
    context: RequestContext,
    reason: string,
    incrementAccountFailure = true,
  ): Promise<void> {
    const now = this.#now();
    const policy = this.#config.policy;
    await this.#transaction(async (client) => {
      const buckets = [
        { kind: 'identity' as const, threshold: policy.identityFailureThreshold },
        { kind: 'network' as const, threshold: policy.networkFailureThreshold },
        { kind: 'identity-network' as const, threshold: policy.pairFailureThreshold },
      ];
      for (const bucket of buckets) {
        await client.query(
          'SELECT * FROM core.authentication_throttle_failure($1,$2,$3,$4,$5,$6)',
          [
            this.#throttleDigest(bucket.kind, username, context.remoteAddress),
            bucket.kind,
            now,
            policy.throttleWindowSeconds,
            bucket.threshold,
            policy.throttleBlockSeconds,
          ],
        );
      }
      let locked = false;
      if (identity && identity.status !== 'disabled' && incrementAccountFailure) {
        const updated = await client.query<{ status: string }>(
          `UPDATE core.identities SET
             failed_login_count=failed_login_count+1,
             status=CASE WHEN failed_login_count+1 >= $2 THEN 'locked' ELSE status END,
             locked_until=CASE WHEN failed_login_count+1 >= $2 THEN $3 ELSE locked_until END
           WHERE id=$1 RETURNING status`,
          [
            identity.id,
            policy.accountLockFailureThreshold,
            new Date(now.getTime() + policy.accountLockMs),
          ],
        );
        locked = updated.rows[0]?.status === 'locked';
        if (locked) {
          await client.query(
            "UPDATE core.identity_sessions SET revoked_at=$2, revocation_reason='account-locked' WHERE identity_id=$1 AND revoked_at IS NULL",
            [identity.id, now],
          );
        }
      }
      await this.#audit(
        client,
        { kind: 'service', id: AUTHENTICATION_SYSTEM_PRINCIPAL_ID },
        'identity.login.denied',
        'denied',
        context,
        'identity',
        identity?.id ?? null,
        {
          reason,
          accountLocked: locked,
          usernameDigest: this.#contextDigest('username', username),
          remoteAddressDigest: this.#contextDigest('remote', context.remoteAddress),
        },
      );
    });
  }

  async #mfaVerification(
    identity: IdentityRow,
    supplied: string | undefined,
    now: Date,
  ): Promise<{
    enrollmentId: string;
    recoveryDigest: Buffer | null;
    totpCounter: bigint | null;
  } | null> {
    if (!identity.mfa_enabled) return { enrollmentId: '', recoveryDigest: null, totpCounter: null };
    if (!supplied) return null;
    const result = await this.#pool.query<MfaRow>(
      "SELECT id, identity_id, secret_ciphertext, secret_key_version, state, expires_at, last_verified_counter::text FROM core.mfa_enrollments WHERE identity_id=$1 AND state='active' ORDER BY confirmed_at DESC LIMIT 1",
      [identity.id],
    );
    const enrollment = result.rows[0];
    if (!enrollment) return null;
    const secret = decryptMfaSecret(
      enrollment.secret_ciphertext,
      this.#key(enrollment.secret_key_version),
    );
    const totpCounter = verifyTotpCounter(secret, supplied, now);
    if (
      totpCounter !== null &&
      (enrollment.last_verified_counter === null ||
        totpCounter > BigInt(enrollment.last_verified_counter))
    ) {
      return { enrollmentId: enrollment.id, recoveryDigest: null, totpCounter };
    }
    const recoveryDigest = digestSecret(
      `mfa-recovery:${normalizeRecoveryCode(supplied)}`,
      this.#config.tokenPepper,
    );
    const recovery = await this.#pool.query(
      'SELECT 1 FROM core.mfa_recovery_codes WHERE enrollment_id=$1 AND code_digest=$2 AND used_at IS NULL',
      [enrollment.id, recoveryDigest],
    );
    return recovery.rowCount
      ? { enrollmentId: enrollment.id, recoveryDigest, totpCounter: null }
      : null;
  }

  async login(input: LoginInput, context: RequestContext): Promise<LoginResult> {
    const username = normalizeUsername(input.username);
    const now = this.#now();
    const blockedUntil = await this.#blocked(username, context.remoteAddress, now);
    if (blockedUntil) {
      await this.#audit(
        this.#pool,
        { kind: 'service', id: AUTHENTICATION_SYSTEM_PRINCIPAL_ID },
        'identity.login.throttled',
        'denied',
        context,
        'identity',
        null,
        {
          usernameDigest: this.#contextDigest('username', username),
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000),
          ),
        },
      );
      throw new AuthenticationError(
        'AUTH_RATE_LIMITED',
        429,
        'Login temporarily unavailable',
        Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1_000)),
      );
    }

    const identityResult = await this.#pool.query<IdentityRow>(
      `SELECT id,username,display_name,password_hash,status,mfa_enabled,failed_login_count,locked_until,require_password_change
       FROM core.identities WHERE lower(username)=$1`,
      [username],
    );
    const identity = identityResult.rows[0] ?? null;
    const passwordHash = identity?.password_hash ?? this.#dummyPasswordHash;
    const passwordValid = await this.#passwords.verify(passwordHash, input.password);
    const lockActive =
      identity?.status === 'locked' && (!identity.locked_until || identity.locked_until > now);
    const eligible = Boolean(identity && identity.status !== 'disabled' && !lockActive);
    if (!passwordValid || !eligible || !identity) {
      await this.#recordLoginFailure(identity, username, context, 'invalid-credentials');
      throw new AuthenticationError(
        'AUTH_INVALID_CREDENTIALS',
        401,
        'Invalid username or password',
      );
    }

    const mfa = await this.#mfaVerification(identity, input.mfaCode, now);
    if (!mfa) {
      await this.#recordLoginFailure(
        identity,
        username,
        context,
        input.mfaCode ? 'invalid-mfa' : 'mfa-required',
        Boolean(input.mfaCode),
      );
      throw new AuthenticationError(
        input.mfaCode ? 'AUTH_MFA_INVALID' : 'AUTH_MFA_REQUIRED',
        401,
        input.mfaCode ? 'Invalid authentication code' : 'Multi-factor authentication required',
      );
    }

    const sessionId = canonicalId('ses');
    const secret = opaqueSecret();
    const sessionToken = formatOpaqueCredential(sessionId, secret);
    const csrfToken = opaqueSecret();
    const expiresAt = new Date(now.getTime() + this.#config.policy.sessionTtlMs);
    const result = await this.#transaction(async (client): Promise<LoginResult> => {
      const current = await client.query<IdentityRow>(
        `SELECT id,username,display_name,password_hash,status,mfa_enabled,failed_login_count,locked_until,require_password_change
         FROM core.identities WHERE id=$1 FOR UPDATE`,
        [identity.id],
      );
      const lockedIdentity = current.rows[0];
      if (
        !lockedIdentity ||
        lockedIdentity.status === 'disabled' ||
        (lockedIdentity.status === 'locked' &&
          (!lockedIdentity.locked_until || lockedIdentity.locked_until > now))
      ) {
        throw new AuthenticationError(
          'AUTH_INVALID_CREDENTIALS',
          401,
          'Invalid username or password',
        );
      }
      if (mfa.totpCounter !== null) {
        const consumed = await client.query(
          `UPDATE core.mfa_enrollments SET last_verified_counter=$2
           WHERE id=$1 AND (last_verified_counter IS NULL OR last_verified_counter<$2)`,
          [mfa.enrollmentId, mfa.totpCounter.toString()],
        );
        if (!consumed.rowCount)
          throw new AuthenticationError('AUTH_MFA_INVALID', 401, 'Invalid authentication code');
      }
      if (mfa.recoveryDigest) {
        const consumed = await client.query(
          'UPDATE core.mfa_recovery_codes SET used_at=$3 WHERE enrollment_id=$1 AND code_digest=$2 AND used_at IS NULL',
          [mfa.enrollmentId, mfa.recoveryDigest, now],
        );
        if (!consumed.rowCount)
          throw new AuthenticationError('AUTH_MFA_INVALID', 401, 'Invalid authentication code');
      }
      await client.query(
        "UPDATE core.identities SET status='active', failed_login_count=0, locked_until=NULL WHERE id=$1",
        [identity.id],
      );
      await client.query(
        'DELETE FROM core.authentication_throttles WHERE bucket_digest=$1 OR bucket_digest=$2',
        [
          this.#throttleDigest('identity', username, context.remoteAddress),
          this.#throttleDigest('identity-network', username, context.remoteAddress),
        ],
      );
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `auth-sessions:${identity.id}`,
      ]);
      await client.query(
        `UPDATE core.identity_sessions SET revoked_at=$2, revocation_reason='session-limit'
         WHERE id IN (
           SELECT id FROM core.identity_sessions
           WHERE identity_id=$1 AND revoked_at IS NULL AND expires_at>$2
           ORDER BY last_seen_at DESC, created_at DESC
           OFFSET $3
         )`,
        [identity.id, now, this.#config.policy.maxSessionsPerIdentity - 1],
      );
      await client.query(
        `INSERT INTO core.identity_sessions
          (id,identity_id,token_digest,csrf_digest,device_label,remote_address,user_agent,created_at,last_seen_at,expires_at,mfa_verified,authentication_method)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11)`,
        [
          sessionId,
          identity.id,
          digestSecret(sessionToken, this.#config.tokenPepper),
          digestSecret(csrfToken, this.#config.tokenPepper),
          context.deviceLabel?.slice(0, 200) ?? null,
          context.remoteAddress,
          context.userAgent?.slice(0, 1_000) ?? null,
          now,
          expiresAt,
          identity.mfa_enabled,
          identity.mfa_enabled ? 'password-mfa' : 'password',
        ],
      );
      const authorization = await this.#authorization(client, 'user', identity.id, GLOBAL_SCOPE);
      const principal: UserPrincipal = {
        kind: 'user',
        id: identity.id,
        username: identity.username,
        displayName: identity.display_name,
        roles: uniqueSorted(authorization.roles),
        permissions: uniqueSorted(authorization.permissions),
        mfaVerified: identity.mfa_enabled,
        passwordChangeRequired: identity.require_password_change,
        sessionId,
      };
      await this.#audit(
        client,
        principal,
        'identity.login.succeeded',
        'succeeded',
        context,
        'session',
        sessionId,
        {
          mfaVerified: identity.mfa_enabled,
          recoveryCodeUsed: Boolean(mfa.recoveryDigest),
          remoteAddressDigest: this.#contextDigest('remote', context.remoteAddress),
        },
      );
      this.#markAuthenticated(principal);
      return { principal, sessionToken, csrfToken, expiresAt };
    });

    if (this.#passwords.needsRehash(identity.password_hash)) {
      const replacement = await this.#passwords.hash(input.password);
      await this.#pool.query(
        'UPDATE core.identities SET password_hash=$2 WHERE id=$1 AND password_hash=$3',
        [identity.id, replacement, identity.password_hash],
      );
    }
    return result;
  }

  async authenticateSession(sessionToken: string | undefined): Promise<SessionAuthentication> {
    if (!sessionToken)
      throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
    const parsed = parseOpaqueCredential(sessionToken, 'ses');
    if (!parsed) throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
    const result = await this.#pool.query<
      IdentityRow &
        QueryResultRow & {
          session_id: string;
          token_digest: Buffer;
          csrf_digest: Buffer;
          expires_at: Date;
          mfa_verified: boolean;
        }
    >(
      `SELECT identity.id,identity.username,identity.display_name,identity.password_hash,identity.status,identity.mfa_enabled,
              identity.failed_login_count,identity.locked_until,identity.require_password_change,
              session.id AS session_id,session.token_digest,session.csrf_digest,session.expires_at,session.mfa_verified
       FROM core.identity_sessions session
       JOIN core.identities identity ON identity.id=session.identity_id
       WHERE session.id=$1 AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp()`,
      [parsed.id],
    );
    const row = result.rows[0];
    const suppliedDigest = digestSecret(sessionToken, this.#config.tokenPepper);
    if (!row || !safeEqual(row.token_digest, suppliedDigest) || row.status !== 'active') {
      throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
    }
    const authorization = await this.#authorization(this.#pool, 'user', row.id, GLOBAL_SCOPE);
    const now = this.#now();
    await this.#pool.query(
      'UPDATE core.identity_sessions SET last_seen_at=$2 WHERE id=$1 AND last_seen_at < $3',
      [row.session_id, now, new Date(now.getTime() - this.#config.policy.sessionTouchIntervalMs)],
    );
    return this.#markAuthenticated({
      kind: 'user',
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      roles: uniqueSorted(authorization.roles),
      permissions: uniqueSorted(authorization.permissions),
      mfaVerified: row.mfa_verified,
      passwordChangeRequired: row.require_password_change,
      sessionId: row.session_id,
      csrfDigest: row.csrf_digest,
      expiresAt: row.expires_at,
    });
  }

  verifyCsrf(
    session: SessionAuthentication,
    header: string | undefined,
    cookie: string | undefined,
  ): void {
    this.#assertAuthenticated(session);
    if (
      !header ||
      !cookie ||
      !safeStringEqual(header, cookie) ||
      !safeEqual(digestSecret(header, this.#config.tokenPepper), session.csrfDigest)
    ) {
      throw new AuthenticationError('CSRF_INVALID', 403, 'CSRF validation failed');
    }
  }

  async listSessions(principal: UserPrincipal): Promise<readonly SessionSummary[]> {
    await this.#assertPrincipalActive(principal);
    const result = await this.#pool.query<
      {
        id: string;
        identity_id: string;
        created_at: Date;
        last_seen_at: Date;
        expires_at: Date;
        revoked_at: Date | null;
        device_label: string | null;
        version: string;
        updated_at: Date;
      } & QueryResultRow
    >(
      `SELECT id,identity_id,created_at,last_seen_at,expires_at,revoked_at,device_label,version::text,updated_at
       FROM core.identity_sessions WHERE identity_id=$1 ORDER BY created_at DESC`,
      [principal.id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.identity_id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      deviceLabel: row.device_label,
      version: Number(row.version),
      updatedAt: row.updated_at,
      current: row.id === principal.sessionId,
    }));
  }

  async revokeSession(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.#assertPrincipalActive(principal);
    const target = await this.#pool.query<{ identity_id: string } & QueryResultRow>(
      'SELECT identity_id FROM core.identity_sessions WHERE id=$1',
      [sessionId],
    );
    if (!target.rows[0])
      throw new AuthenticationError('AUTH_SESSION_NOT_FOUND', 404, 'Session not found');
    if (principal.kind !== 'user' || target.rows[0].identity_id !== principal.id) {
      await this.authorize(principal, 'identity.sessions.manage', GLOBAL_SCOPE, context);
    }
    await this.#transaction(async (client) => {
      const changed = await client.query(
        "UPDATE core.identity_sessions SET revoked_at=$2, revocation_reason='explicit-revocation' WHERE id=$1 AND revoked_at IS NULL",
        [sessionId, this.#now()],
      );
      if (changed.rowCount)
        await this.#audit(
          client,
          principal,
          'identity.session.revoked',
          'succeeded',
          context,
          'session',
          sessionId,
          {},
        );
    });
  }

  async logout(session: SessionAuthentication, context: RequestContext): Promise<void> {
    await this.#assertPrincipalActive(session);
    await this.#transaction(async (client) => {
      await client.query(
        "UPDATE core.identity_sessions SET revoked_at=$2, revocation_reason='logout' WHERE id=$1 AND revoked_at IS NULL",
        [session.sessionId, this.#now()],
      );
      await this.#audit(
        client,
        session,
        'identity.logout.succeeded',
        'succeeded',
        context,
        'session',
        session.sessionId,
        {},
      );
    });
  }

  async #assertPasswordNotReused(
    database: Database,
    identity: IdentityRow,
    password: string,
  ): Promise<void> {
    if (await this.#passwords.verify(identity.password_hash, password))
      throw new AuthenticationError('AUTH_PASSWORD_REUSED', 422, 'Password was used recently');
    const history = await database.query<{ password_hash: string } & QueryResultRow>(
      'SELECT password_hash FROM core.password_history WHERE identity_id=$1 ORDER BY replaced_at DESC, ordinal DESC LIMIT $2',
      [identity.id, this.#config.policy.passwordHistoryCount],
    );
    for (const row of history.rows) {
      if (await this.#passwords.verify(row.password_hash, password))
        throw new AuthenticationError('AUTH_PASSWORD_REUSED', 422, 'Password was used recently');
    }
  }

  async changePassword(
    session: SessionAuthentication,
    input: PasswordChangeInput,
    context: RequestContext,
  ): Promise<void> {
    await this.#assertPrincipalActive(session);
    const result = await this.#pool.query<IdentityRow>(
      `SELECT id,username,display_name,password_hash,status,mfa_enabled,failed_login_count,locked_until,require_password_change
       FROM core.identities WHERE id=$1`,
      [session.id],
    );
    const identity = result.rows[0];
    if (
      !identity ||
      !(await this.#passwords.verify(identity.password_hash, input.currentPassword))
    ) {
      await this.#audit(
        this.#pool,
        session,
        'identity.password.change.denied',
        'denied',
        context,
        'identity',
        session.id,
        { reason: 'invalid-current-password' },
      );
      throw new AuthenticationError('AUTH_INVALID_CREDENTIALS', 401, 'Current password is invalid');
    }
    const validation = validatePassword(input.newPassword, identity.username);
    if (!validation.valid)
      throw new AuthenticationError('AUTH_PASSWORD_POLICY', 422, 'Password does not meet policy');
    await this.#assertPasswordNotReused(this.#pool, identity, input.newPassword);
    const passwordHash = await this.#passwords.hash(input.newPassword);
    await this.#transaction(async (client) => {
      const updated = await client.query(
        `UPDATE core.identities SET password_hash=$2,password_changed_at=$3,require_password_change=false
         WHERE id=$1 AND password_hash=$4`,
        [identity.id, passwordHash, this.#now(), identity.password_hash],
      );
      if (!updated.rowCount)
        throw new AuthenticationError('AUTH_CONFLICT', 409, 'Identity changed concurrently');
      await client.query(
        'INSERT INTO core.password_history (identity_id,password_hash,replaced_at) VALUES ($1,$2,$3)',
        [identity.id, identity.password_hash, this.#now()],
      );
      await client.query(
        `DELETE FROM core.password_history WHERE identity_id=$1 AND ordinal NOT IN (
           SELECT ordinal FROM core.password_history WHERE identity_id=$1 ORDER BY replaced_at DESC, ordinal DESC LIMIT $2
         )`,
        [identity.id, this.#config.policy.passwordHistoryCount],
      );
      if (input.revokeOtherSessions) {
        await client.query(
          "UPDATE core.identity_sessions SET revoked_at=$3,revocation_reason='password-changed' WHERE identity_id=$1 AND id<>$2 AND revoked_at IS NULL",
          [identity.id, session.sessionId, this.#now()],
        );
      }
      await this.#audit(
        client,
        session,
        'identity.password.changed',
        'succeeded',
        context,
        'identity',
        identity.id,
        { otherSessionsRevoked: input.revokeOtherSessions },
      );
    });
  }

  async setTemporaryPassword(
    actor: AuthenticatedPrincipal,
    identityId: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<void> {
    await this.authorize(actor, 'identity.accounts.manage', GLOBAL_SCOPE, context);
    const result = await this.#pool.query<IdentityRow>(
      `SELECT id,username,display_name,password_hash,status,mfa_enabled,failed_login_count,locked_until,require_password_change
       FROM core.identities WHERE id=$1`,
      [identityId],
    );
    const identity = result.rows[0];
    if (!identity)
      throw new AuthenticationError('AUTH_IDENTITY_NOT_FOUND', 404, 'Identity not found');
    const validation = validatePassword(newPassword, identity.username);
    if (!validation.valid)
      throw new AuthenticationError('AUTH_PASSWORD_POLICY', 422, 'Password does not meet policy');
    await this.#assertPasswordNotReused(this.#pool, identity, newPassword);
    const passwordHash = await this.#passwords.hash(newPassword);
    await this.#transaction(async (client) => {
      await client.query(
        "UPDATE core.identities SET password_hash=$2,password_changed_at=$3,require_password_change=true,status='active',failed_login_count=0,locked_until=NULL WHERE id=$1",
        [identity.id, passwordHash, this.#now()],
      );
      await client.query(
        'INSERT INTO core.password_history (identity_id,password_hash,replaced_at) VALUES ($1,$2,$3)',
        [identity.id, identity.password_hash, this.#now()],
      );
      await client.query(
        "UPDATE core.identity_sessions SET revoked_at=$2,revocation_reason='administrator-password-reset' WHERE identity_id=$1 AND revoked_at IS NULL",
        [identity.id, this.#now()],
      );
      await this.#audit(
        client,
        actor,
        'identity.password.reset',
        'succeeded',
        context,
        'identity',
        identity.id,
        { requiresPasswordChange: true },
      );
    });
  }

  async unlockIdentity(
    actor: AuthenticatedPrincipal,
    identityId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.authorize(actor, 'identity.accounts.manage', GLOBAL_SCOPE, context);
    await this.#transaction(async (client) => {
      const updated = await client.query(
        "UPDATE core.identities SET status='active',failed_login_count=0,locked_until=NULL WHERE id=$1 AND status='locked'",
        [identityId],
      );
      if (!updated.rowCount)
        throw new AuthenticationError('AUTH_IDENTITY_NOT_LOCKED', 409, 'Identity is not locked');
      await this.#audit(
        client,
        actor,
        'identity.account.unlocked',
        'succeeded',
        context,
        'identity',
        identityId,
        {},
      );
    });
  }

  async startMfaEnrollment(
    session: SessionAuthentication,
    password: string,
    context: RequestContext,
  ): Promise<MfaEnrollmentChallenge> {
    await this.#assertPrincipalActive(session);
    const identityResult = await this.#pool.query<IdentityRow>(
      `SELECT id,username,display_name,password_hash,status,mfa_enabled,failed_login_count,locked_until,require_password_change FROM core.identities WHERE id=$1`,
      [session.id],
    );
    const identity = identityResult.rows[0];
    if (!identity || !(await this.#passwords.verify(identity.password_hash, password))) {
      await this.#audit(
        this.#pool,
        session,
        'identity.mfa.enrollment.denied',
        'denied',
        context,
        'identity',
        session.id,
        { reason: 'invalid-password' },
      );
      throw new AuthenticationError('AUTH_INVALID_CREDENTIALS', 401, 'Password is invalid');
    }
    const enrollmentId = canonicalId('mfa');
    const secret = generateTotpSecret();
    const recoveryCodes = generateRecoveryCodes();
    const expiresAt = new Date(this.#now().getTime() + this.#config.policy.mfaEnrollmentTtlMs);
    const keyVersion = this.#config.activeMfaKeyVersion;
    await this.#transaction(async (client) => {
      await client.query(
        "UPDATE core.mfa_enrollments SET state='revoked',revoked_at=$2 WHERE identity_id=$1 AND state='pending'",
        [session.id, this.#now()],
      );
      await client.query(
        `INSERT INTO core.mfa_enrollments
          (id,identity_id,secret_ciphertext,secret_key_version,state,expires_at)
         VALUES ($1,$2,$3,$4,'pending',$5)`,
        [
          enrollmentId,
          session.id,
          encryptMfaSecret(secret, this.#key(keyVersion)),
          keyVersion,
          expiresAt,
        ],
      );
      for (const [index, code] of recoveryCodes.entries()) {
        await client.query(
          'INSERT INTO core.mfa_recovery_codes (enrollment_id,ordinal,code_digest) VALUES ($1,$2,$3)',
          [
            enrollmentId,
            index + 1,
            digestSecret(`mfa-recovery:${normalizeRecoveryCode(code)}`, this.#config.tokenPepper),
          ],
        );
      }
      await this.#audit(
        client,
        session,
        'identity.mfa.enrollment.started',
        'succeeded',
        context,
        'mfa-enrollment',
        enrollmentId,
        {},
      );
    });
    return {
      enrollmentId,
      provisioningUri: provisioningUri(this.#config.issuer, identity.username, secret),
      recoveryCodes,
      expiresAt,
    };
  }

  async confirmMfaEnrollment(
    session: SessionAuthentication,
    enrollmentId: string,
    code: string,
    context: RequestContext,
  ): Promise<void> {
    await this.#assertPrincipalActive(session);
    const result = await this.#pool.query<MfaRow>(
      'SELECT id,identity_id,secret_ciphertext,secret_key_version,state,expires_at,last_verified_counter::text FROM core.mfa_enrollments WHERE id=$1 AND identity_id=$2',
      [enrollmentId, session.id],
    );
    const enrollment = result.rows[0];
    const now = this.#now();
    if (!enrollment || enrollment.state !== 'pending' || enrollment.expires_at <= now)
      throw new AuthenticationError(
        'AUTH_MFA_ENROLLMENT_INVALID',
        404,
        'MFA enrollment unavailable',
      );
    const secret = decryptMfaSecret(
      enrollment.secret_ciphertext,
      this.#key(enrollment.secret_key_version),
    );
    const totpCounter = verifyTotpCounter(secret, code, now);
    if (totpCounter === null) {
      await this.#audit(
        this.#pool,
        session,
        'identity.mfa.enrollment.denied',
        'denied',
        context,
        'mfa-enrollment',
        enrollmentId,
        { reason: 'invalid-code' },
      );
      throw new AuthenticationError('AUTH_MFA_INVALID', 401, 'Invalid authentication code');
    }
    await this.#transaction(async (client) => {
      await client.query(
        "UPDATE core.mfa_enrollments SET state='revoked',revoked_at=$2 WHERE identity_id=$1 AND state='active'",
        [session.id, now],
      );
      const confirmed = await client.query(
        "UPDATE core.mfa_enrollments SET state='active',confirmed_at=$3,last_verified_counter=$4 WHERE id=$1 AND identity_id=$2 AND state='pending' AND expires_at>$3",
        [enrollmentId, session.id, now, totpCounter.toString()],
      );
      if (!confirmed.rowCount)
        throw new AuthenticationError(
          'AUTH_MFA_ENROLLMENT_INVALID',
          409,
          'MFA enrollment changed concurrently',
        );
      await client.query('UPDATE core.identities SET mfa_enabled=true WHERE id=$1', [session.id]);
      await client.query(
        "UPDATE core.identity_sessions SET mfa_verified=true,authentication_method='password-mfa' WHERE id=$1 AND revoked_at IS NULL",
        [session.sessionId],
      );
      await client.query(
        "UPDATE core.identity_sessions SET revoked_at=$3,revocation_reason='mfa-enabled' WHERE identity_id=$1 AND id<>$2 AND revoked_at IS NULL",
        [session.id, session.sessionId, now],
      );
      await this.#audit(
        client,
        session,
        'identity.mfa.enabled',
        'succeeded',
        context,
        'identity',
        session.id,
        { enrollmentId },
      );
    });
  }

  async removeMfa(
    session: SessionAuthentication,
    password: string,
    code: string,
    context: RequestContext,
  ): Promise<void> {
    await this.#assertPrincipalActive(session);
    const identityResult = await this.#pool.query<IdentityRow>(
      `SELECT id,username,display_name,password_hash,status,mfa_enabled,failed_login_count,locked_until,require_password_change FROM core.identities WHERE id=$1`,
      [session.id],
    );
    const identity = identityResult.rows[0];
    const passwordValid = Boolean(
      identity && (await this.#passwords.verify(identity.password_hash, password)),
    );
    const mfa = identity ? await this.#mfaVerification(identity, code, this.#now()) : null;
    if (!identity || !passwordValid || !mfa || !identity.mfa_enabled) {
      await this.#audit(
        this.#pool,
        session,
        'identity.mfa.removal.denied',
        'denied',
        context,
        'identity',
        session.id,
        { reason: 'invalid-proof' },
      );
      throw new AuthenticationError(
        'AUTH_INVALID_CREDENTIALS',
        401,
        'Authentication proof is invalid',
      );
    }
    await this.#transaction(async (client) => {
      if (mfa.totpCounter !== null) {
        const consumed = await client.query(
          `UPDATE core.mfa_enrollments SET last_verified_counter=$2
           WHERE id=$1 AND (last_verified_counter IS NULL OR last_verified_counter<$2)`,
          [mfa.enrollmentId, mfa.totpCounter.toString()],
        );
        if (!consumed.rowCount)
          throw new AuthenticationError('AUTH_MFA_INVALID', 401, 'Invalid authentication code');
      }
      if (mfa.recoveryDigest) {
        const consumed = await client.query(
          'UPDATE core.mfa_recovery_codes SET used_at=$3 WHERE enrollment_id=$1 AND code_digest=$2 AND used_at IS NULL',
          [mfa.enrollmentId, mfa.recoveryDigest, this.#now()],
        );
        if (!consumed.rowCount)
          throw new AuthenticationError('AUTH_MFA_INVALID', 401, 'Invalid authentication code');
      }
      await client.query(
        "UPDATE core.mfa_enrollments SET state='revoked',revoked_at=$2 WHERE identity_id=$1 AND state='active'",
        [session.id, this.#now()],
      );
      await client.query('UPDATE core.identities SET mfa_enabled=false WHERE id=$1', [session.id]);
      await client.query(
        "UPDATE core.identity_sessions SET mfa_verified=false,authentication_method='password' WHERE id=$1 AND revoked_at IS NULL",
        [session.sessionId],
      );
      await client.query(
        "UPDATE core.identity_sessions SET revoked_at=$3,revocation_reason='mfa-removed' WHERE identity_id=$1 AND id<>$2 AND revoked_at IS NULL",
        [session.id, session.sessionId, this.#now()],
      );
      await this.#audit(
        client,
        session,
        'identity.mfa.removed',
        'succeeded',
        context,
        'identity',
        session.id,
        {},
      );
    });
  }

  async createServicePrincipal(
    actor: AuthenticatedPrincipal,
    name: string,
    context: RequestContext,
  ): Promise<string> {
    await this.authorize(actor, 'service-credentials.manage', GLOBAL_SCOPE, context);
    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/u.test(name))
      throw new AuthenticationError(
        'AUTH_SERVICE_NAME_INVALID',
        422,
        'Service name does not meet policy',
      );
    const serviceId = canonicalId('svc');
    await this.#transaction(async (client) => {
      await client.query('INSERT INTO core.service_principals (id,name) VALUES ($1,$2)', [
        serviceId,
        name,
      ]);
      await this.#audit(
        client,
        actor,
        'identity.service.created',
        'succeeded',
        context,
        'service',
        serviceId,
        {},
      );
    });
    return serviceId;
  }

  async issueServiceCredential(
    actor: AuthenticatedPrincipal,
    input: ServiceCredentialInput,
    context: RequestContext,
  ): Promise<IssuedServiceCredential> {
    await this.authorize(actor, 'service-credentials.manage', GLOBAL_SCOPE, context);
    if (!ID_PATTERN.test(input.serviceId) || !input.serviceId.startsWith('svc_'))
      throw new AuthenticationError('AUTH_SERVICE_INVALID', 422, 'Service ID is invalid');
    if (input.label.trim().length < 1 || input.label.length > 200)
      throw new AuthenticationError(
        'AUTH_CREDENTIAL_LABEL_INVALID',
        422,
        'Credential label is invalid',
      );
    const scopes = uniqueSorted(input.scopes);
    if (
      scopes.length < 1 ||
      scopes.length > 100 ||
      scopes.some((scope) => !SCOPE_PATTERN.test(scope))
    ) {
      throw new AuthenticationError(
        'AUTH_CREDENTIAL_SCOPES_INVALID',
        422,
        'Credential scopes are invalid',
      );
    }
    if (input.expiresAt && input.expiresAt <= this.#now())
      throw new AuthenticationError(
        'AUTH_CREDENTIAL_EXPIRY_INVALID',
        422,
        'Credential expiry is invalid',
      );
    const service = await this.#pool.query(
      "SELECT 1 FROM core.service_principals WHERE id=$1 AND status='active'",
      [input.serviceId],
    );
    if (!service.rowCount)
      throw new AuthenticationError('AUTH_SERVICE_NOT_FOUND', 404, 'Service not found');
    const credentialId = canonicalId('crd');
    const token = formatOpaqueCredential(credentialId, opaqueSecret());
    const createdAt = this.#now();
    await this.#transaction(async (client) => {
      await client.query(
        'INSERT INTO core.service_credentials (id,service_id,label,token_digest,scopes,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          credentialId,
          input.serviceId,
          input.label.trim(),
          digestSecret(token, this.#config.tokenPepper),
          scopes,
          createdAt,
          input.expiresAt ?? null,
        ],
      );
      await this.#audit(
        client,
        actor,
        'identity.service-credential.issued',
        'succeeded',
        context,
        'credential',
        credentialId,
        { serviceId: input.serviceId, scopes },
      );
    });
    return {
      token,
      credential: {
        id: credentialId,
        serviceId: input.serviceId,
        label: input.label.trim(),
        scopes,
        createdAt,
        expiresAt: input.expiresAt ?? null,
        revokedAt: null,
        lastUsedAt: null,
      },
    };
  }

  async listServiceCredentials(
    actor: AuthenticatedPrincipal,
    context: RequestContext,
  ): Promise<readonly ServiceCredentialMetadata[]> {
    await this.authorize(actor, 'service-credentials.read', GLOBAL_SCOPE, context);
    const result = await this.#pool.query<
      {
        id: string;
        service_id: string;
        label: string;
        scopes: string[];
        created_at: Date;
        expires_at: Date | null;
        revoked_at: Date | null;
        last_used_at: Date | null;
      } & QueryResultRow
    >(
      'SELECT id,service_id,label,scopes,created_at,expires_at,revoked_at,last_used_at FROM core.service_credentials ORDER BY created_at DESC',
    );
    return result.rows.map((row) => ({
      id: row.id,
      serviceId: row.service_id,
      label: row.label,
      scopes: row.scopes,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      lastUsedAt: row.last_used_at,
    }));
  }

  async revokeServiceCredential(
    actor: AuthenticatedPrincipal,
    credentialId: string,
    context: RequestContext,
  ): Promise<void> {
    await this.authorize(actor, 'service-credentials.manage', GLOBAL_SCOPE, context);
    await this.#transaction(async (client) => {
      const result = await client.query(
        'UPDATE core.service_credentials SET revoked_at=$2 WHERE id=$1 AND revoked_at IS NULL',
        [credentialId, this.#now()],
      );
      if (!result.rowCount)
        throw new AuthenticationError('AUTH_CREDENTIAL_NOT_FOUND', 404, 'Credential not found');
      await this.#audit(
        client,
        actor,
        'identity.service-credential.revoked',
        'succeeded',
        context,
        'credential',
        credentialId,
        {},
      );
    });
  }

  async authenticateService(
    token: string | undefined,
    context: RequestContext,
  ): Promise<ServicePrincipal> {
    const parsed = token ? parseOpaqueCredential(token, 'crd') : null;
    if (!parsed) {
      await this.#audit(
        this.#pool,
        { kind: 'service', id: AUTHENTICATION_SYSTEM_PRINCIPAL_ID },
        'identity.service-authentication.denied',
        'denied',
        context,
        'credential',
        null,
        { reason: 'malformed-token' },
      );
      throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
    }
    const result = await this.#pool.query<
      {
        id: string;
        token_digest: Buffer;
        scopes: string[];
        expires_at: Date | null;
        revoked_at: Date | null;
        service_id: string;
        name: string;
        status: string;
      } & QueryResultRow
    >(
      `SELECT credential.id,credential.token_digest,credential.scopes,credential.expires_at,credential.revoked_at,
              service.id AS service_id,service.name,service.status
       FROM core.service_credentials credential JOIN core.service_principals service ON service.id=credential.service_id
       WHERE credential.id=$1`,
      [parsed.id],
    );
    const row = result.rows[0];
    const now = this.#now();
    if (
      !row ||
      !safeEqual(row.token_digest, digestSecret(token!, this.#config.tokenPepper)) ||
      row.revoked_at ||
      (row.expires_at && row.expires_at <= now) ||
      row.status !== 'active'
    ) {
      await this.#audit(
        this.#pool,
        { kind: 'service', id: AUTHENTICATION_SYSTEM_PRINCIPAL_ID },
        'identity.service-authentication.denied',
        'denied',
        context,
        'credential',
        parsed.id,
        { reason: 'invalid-token' },
      );
      throw new AuthenticationError('AUTH_REQUIRED', 401, 'Authentication required');
    }
    const authorization = await this.#authorization(
      this.#pool,
      'service',
      row.service_id,
      GLOBAL_SCOPE,
    );
    const principal: ServicePrincipal = this.#markAuthenticated({
      kind: 'service',
      id: row.service_id,
      name: row.name,
      roles: uniqueSorted(authorization.roles),
      permissions: uniqueSorted(
        authorization.permissions.filter((permission) =>
          credentialScopeAllows(row.scopes, permission),
        ),
      ),
      credentialId: row.id,
      credentialScopes: row.scopes,
    });
    await this.#transaction(async (client) => {
      await client.query(
        'UPDATE core.service_credentials SET last_used_at=$2 WHERE id=$1 AND (last_used_at IS NULL OR last_used_at<$3)',
        [row.id, now, new Date(now.getTime() - this.#config.policy.sessionTouchIntervalMs)],
      );
      await this.#audit(
        client,
        principal,
        'identity.service-authentication.succeeded',
        'succeeded',
        context,
        'credential',
        row.id,
        {
          remoteAddressDigest: this.#contextDigest('remote', context.remoteAddress),
        },
      );
    });
    return principal;
  }

  async grantRole(
    actor: AuthenticatedPrincipal,
    principal: { kind: 'user' | 'service'; id: string },
    roleKey: string,
    scope: AuthorizationScope,
    expiresAt: Date | undefined,
    context: RequestContext,
  ): Promise<void> {
    await this.authorize(actor, 'authorization.manage', scope, context);
    await this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO core.authorization_bindings
          (principal_kind,principal_id,role_key,scope_kind,scope_id,granted_by_kind,granted_by_id,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (principal_kind,principal_id,role_key,scope_kind,scope_id)
         DO UPDATE SET granted_by_kind=EXCLUDED.granted_by_kind,granted_by_id=EXCLUDED.granted_by_id,granted_at=clock_timestamp(),expires_at=EXCLUDED.expires_at`,
        [
          principal.kind,
          principal.id,
          roleKey,
          scope.kind,
          scope.id,
          actor.kind,
          actor.id,
          expiresAt ?? null,
        ],
      );
      await this.#audit(
        client,
        actor,
        'authorization.role.granted',
        'succeeded',
        context,
        'authorization',
        principal.id,
        { roleKey, scopeKind: scope.kind, scopeId: scope.id },
      );
    });
  }

  async revokeRole(
    actor: AuthenticatedPrincipal,
    principal: { kind: 'user' | 'service'; id: string },
    roleKey: string,
    scope: AuthorizationScope,
    context: RequestContext,
  ): Promise<void> {
    await this.authorize(actor, 'authorization.manage', scope, context);
    await this.#transaction(async (client) => {
      const result = await client.query(
        'DELETE FROM core.authorization_bindings WHERE principal_kind=$1 AND principal_id=$2 AND role_key=$3 AND scope_kind=$4 AND scope_id=$5',
        [principal.kind, principal.id, roleKey, scope.kind, scope.id],
      );
      if (!result.rowCount)
        throw new AuthenticationError(
          'AUTH_BINDING_NOT_FOUND',
          404,
          'Authorization binding not found',
        );
      await this.#audit(
        client,
        actor,
        'authorization.role.revoked',
        'succeeded',
        context,
        'authorization',
        principal.id,
        { roleKey, scopeKind: scope.kind, scopeId: scope.id },
      );
    });
  }
}
