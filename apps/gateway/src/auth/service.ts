import type { AuthStore, PrincipalRecord, SessionRecord, SessionSummary } from './types.js';
import { opaqueToken, sha256, verifyPassword } from './crypto.js';
export class AuthError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export interface AuthServiceOptions {
  store: AuthStore;
  pepper: string;
  sessionTtlMs?: number;
  now?: () => Date;
}
export interface LoginContext {
  ip: string;
  userAgent: string | undefined;
  deviceLabel?: string | undefined;
}
export interface LoginResult {
  principal: PrincipalRecord;
  sessionId: string;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}
export class AuthService {
  readonly #store: AuthStore;
  readonly #pepper: string;
  readonly #ttl: number;
  readonly #now: () => Date;
  constructor(options: AuthServiceOptions) {
    this.#store = options.store;
    this.#pepper = options.pepper;
    this.#ttl = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
    this.#now = options.now ?? (() => new Date());
  }
  async login(username: string, password: string, context: LoginContext): Promise<LoginResult> {
    const normalized = username.trim().toLowerCase();
    const subject = sha256(`${this.#pepper}:${normalized}:${context.ip}`);
    const now = this.#now();
    const throttle = await this.#store.getLoginThrottle(subject);
    if (throttle?.blockedUntil && throttle.blockedUntil > now)
      throw new AuthError('AUTH_RATE_LIMITED', 429, 'Login temporarily unavailable');
    const user = await this.#store.findUserByUsername(normalized);
    const valid =
      user?.status === 'active' &&
      (await verifyPassword(password, user.passwordHash, this.#pepper));
    if (!valid || !user) {
      const failures = (throttle?.failedCount ?? 0) + 1;
      const blocked =
        failures >= 5
          ? new Date(now.getTime() + Math.min(15 * 60_000, 30_000 * 2 ** (failures - 5)))
          : null;
      await this.#store.recordLoginFailure(subject, blocked);
      throw new AuthError('AUTH_INVALID_CREDENTIALS', 401, 'Invalid username or password');
    }
    await this.#store.clearLoginFailures(subject);
    const sessionToken = opaqueToken();
    const csrfToken = opaqueToken();
    const expiresAt = new Date(now.getTime() + this.#ttl);
    const sessionId = await this.#store.createSession({
      userId: user.id,
      tokenHash: sha256(sessionToken),
      csrfHash: sha256(csrfToken),
      deviceLabel: context.deviceLabel?.slice(0, 200) ?? null,
      ipHash: sha256(`${this.#pepper}:${context.ip}`),
      userAgentHash: context.userAgent ? sha256(`${this.#pepper}:${context.userAgent}`) : null,
      expiresAt,
    });
    const principal = await this.#store.getPrincipal(user.id);
    if (!principal) throw new AuthError('AUTH_PRINCIPAL_UNAVAILABLE', 503, 'Principal unavailable');
    return { principal, sessionId, sessionToken, csrfToken, expiresAt };
  }
  async authenticate(sessionToken: string | undefined): Promise<SessionRecord> {
    if (!sessionToken) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication required');
    const session = await this.#store.findActiveSession(sha256(sessionToken), this.#now());
    if (!session) throw new AuthError('AUTH_REQUIRED', 401, 'Authentication required');
    await this.#store.touchSession(session.sessionId, this.#now());
    return session;
  }
  verifyCsrf(session: SessionRecord, header: string | undefined, cookie: string | undefined): void {
    if (!header || !cookie || header !== cookie || sha256(header) !== session.csrfHash)
      throw new AuthError('CSRF_INVALID', 403, 'CSRF validation failed');
  }
  requirePermission(principal: PrincipalRecord, permission: string): void {
    if (!principal.permissions.includes(permission))
      throw new AuthError('AUTH_FORBIDDEN', 403, 'Forbidden');
  }
  listSessions(userId: string): Promise<SessionSummary[]> {
    return this.#store.listSessions(userId);
  }
  revokeSession(sessionId: string, reason: string): Promise<boolean> {
    return this.#store.revokeSession(sessionId, reason, this.#now());
  }
}
