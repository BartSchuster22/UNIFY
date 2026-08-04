import type { Argon2idPolicy } from './crypto.js';

export type PrincipalKind = 'user' | 'service';
export type ScopeKind = 'global' | 'framework' | 'profile' | 'project';

export interface AuthorizationScope {
  readonly kind: ScopeKind;
  readonly id: string;
}

export interface RequestContext {
  readonly remoteAddress: string;
  readonly userAgent?: string;
  readonly deviceLabel?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
}

export interface UserPrincipal {
  readonly kind: 'user';
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly mfaVerified: boolean;
  readonly passwordChangeRequired: boolean;
  readonly sessionId: string;
}

export interface ServicePrincipal {
  readonly kind: 'service';
  readonly id: string;
  readonly name: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly credentialId: string;
  readonly credentialScopes: readonly string[];
}

export type AuthenticatedPrincipal = UserPrincipal | ServicePrincipal;

export interface SessionAuthentication extends UserPrincipal {
  readonly csrfDigest: Buffer;
  readonly expiresAt: Date;
}

export interface LoginResult {
  readonly principal: UserPrincipal;
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly expiresAt: Date;
}

export interface SessionSummary {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly deviceLabel: string | null;
  readonly version: number;
  readonly updatedAt: Date;
  readonly current: boolean;
}

export interface MfaEnrollmentChallenge {
  readonly enrollmentId: string;
  readonly provisioningUri: string;
  readonly recoveryCodes: readonly string[];
  readonly expiresAt: Date;
}

export interface ServiceCredentialMetadata {
  readonly id: string;
  readonly serviceId: string;
  readonly label: string;
  readonly scopes: readonly string[];
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly lastUsedAt: Date | null;
}

export interface IssuedServiceCredential {
  readonly credential: ServiceCredentialMetadata;
  readonly token: string;
}

export interface BootstrapInput {
  readonly token: string;
  readonly username: string;
  readonly displayName: string;
  readonly password: string;
}

export interface LoginInput {
  readonly username: string;
  readonly password: string;
  readonly mfaCode?: string;
}

export interface PasswordChangeInput {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly revokeOtherSessions: boolean;
}

export interface ServiceCredentialInput {
  readonly serviceId: string;
  readonly label: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: Date;
}

export interface AuthenticationPolicy {
  readonly sessionTtlMs: number;
  readonly maxSessionsPerIdentity: number;
  readonly sessionTouchIntervalMs: number;
  readonly throttleWindowSeconds: number;
  readonly pairFailureThreshold: number;
  readonly identityFailureThreshold: number;
  readonly networkFailureThreshold: number;
  readonly throttleBlockSeconds: number;
  readonly accountLockFailureThreshold: number;
  readonly accountLockMs: number;
  readonly passwordHistoryCount: number;
  readonly mfaEnrollmentTtlMs: number;
  readonly argon2id: Argon2idPolicy;
}

export interface AuthenticationConfig {
  readonly passwordPepper: string;
  readonly tokenPepper: string;
  readonly mfaEncryptionKeys: ReadonlyMap<number, Buffer>;
  readonly activeMfaKeyVersion: number;
  readonly bootstrapToken?: string;
  readonly issuer: string;
  readonly policy: AuthenticationPolicy;
}

export class AuthenticationError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
