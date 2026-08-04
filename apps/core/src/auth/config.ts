import { PRODUCTION_ARGON2ID_POLICY } from './crypto.js';
import type { AuthenticationConfig, AuthenticationPolicy } from './types.js';

export const DEFAULT_AUTHENTICATION_POLICY: AuthenticationPolicy = Object.freeze({
  sessionTtlMs: 8 * 60 * 60 * 1_000,
  maxSessionsPerIdentity: 10,
  sessionTouchIntervalMs: 5 * 60 * 1_000,
  throttleWindowSeconds: 15 * 60,
  pairFailureThreshold: 5,
  identityFailureThreshold: 10,
  networkFailureThreshold: 50,
  throttleBlockSeconds: 15 * 60,
  accountLockFailureThreshold: 10,
  accountLockMs: 15 * 60 * 1_000,
  passwordHistoryCount: 5,
  mfaEnrollmentTtlMs: 10 * 60 * 1_000,
  argon2id: PRODUCTION_ARGON2ID_POLICY,
});

function requiredSecret(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value || Buffer.byteLength(value, 'utf8') < 32)
    throw new Error(`${name} must contain at least 32 bytes`);
  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return parsed;
}

function mfaKeysFromEnvironment(
  environment: NodeJS.ProcessEnv,
  activeVersion: number,
): ReadonlyMap<number, Buffer> {
  const serialized = environment.CORE_AUTH_MFA_KEYS_JSON;
  if (!serialized) {
    const keyText = environment.CORE_AUTH_MFA_KEY_BASE64;
    if (!keyText)
      throw new Error('CORE_AUTH_MFA_KEY_BASE64 or CORE_AUTH_MFA_KEYS_JSON is required');
    const key = Buffer.from(keyText, 'base64');
    if (key.length !== 32) throw new Error('CORE_AUTH_MFA_KEY_BASE64 must decode to 32 bytes');
    return new Map([[activeVersion, key]]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('CORE_AUTH_MFA_KEYS_JSON must be valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('CORE_AUTH_MFA_KEYS_JSON must be an object');
  const keys = new Map<number, Buffer>();
  for (const [versionText, encoded] of Object.entries(parsed)) {
    const version = Number(versionText);
    const key = typeof encoded === 'string' ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
    if (!Number.isInteger(version) || version < 1 || key.length !== 32)
      throw new Error('CORE_AUTH_MFA_KEYS_JSON contains an invalid key version or value');
    keys.set(version, key);
  }
  if (!keys.has(activeVersion))
    throw new Error('CORE_AUTH_MFA_KEYS_JSON does not contain CORE_AUTH_MFA_KEY_VERSION');
  return keys;
}

export function authenticationConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AuthenticationConfig {
  const passwordPepper = requiredSecret(environment, 'CORE_AUTH_PASSWORD_PEPPER');
  const tokenPepper = requiredSecret(environment, 'CORE_AUTH_TOKEN_PEPPER');
  const activeMfaKeyVersion = positiveInteger(
    environment.CORE_AUTH_MFA_KEY_VERSION,
    1,
    'CORE_AUTH_MFA_KEY_VERSION',
    1,
    2_147_483_647,
  );
  const mfaEncryptionKeys = mfaKeysFromEnvironment(environment, activeMfaKeyVersion);
  const bootstrapToken = environment.CORE_AUTH_BOOTSTRAP_TOKEN;
  if (bootstrapToken && Buffer.byteLength(bootstrapToken, 'utf8') < 32)
    throw new Error('CORE_AUTH_BOOTSTRAP_TOKEN must contain at least 32 bytes');

  return {
    passwordPepper,
    tokenPepper,
    mfaEncryptionKeys,
    activeMfaKeyVersion,
    ...(bootstrapToken ? { bootstrapToken } : {}),
    issuer: environment.CORE_AUTH_MFA_ISSUER?.trim() || 'UNIFY Core',
    policy: {
      ...DEFAULT_AUTHENTICATION_POLICY,
      sessionTtlMs:
        positiveInteger(
          environment.CORE_AUTH_SESSION_TTL_SECONDS,
          8 * 60 * 60,
          'CORE_AUTH_SESSION_TTL_SECONDS',
          300,
          31 * 24 * 60 * 60,
        ) * 1_000,
      maxSessionsPerIdentity: positiveInteger(
        environment.CORE_AUTH_MAX_SESSIONS,
        10,
        'CORE_AUTH_MAX_SESSIONS',
        1,
        100,
      ),
      pairFailureThreshold: positiveInteger(
        environment.CORE_AUTH_PAIR_FAILURE_THRESHOLD,
        5,
        'CORE_AUTH_PAIR_FAILURE_THRESHOLD',
        2,
        100,
      ),
      identityFailureThreshold: positiveInteger(
        environment.CORE_AUTH_IDENTITY_FAILURE_THRESHOLD,
        10,
        'CORE_AUTH_IDENTITY_FAILURE_THRESHOLD',
        2,
        1_000,
      ),
      networkFailureThreshold: positiveInteger(
        environment.CORE_AUTH_NETWORK_FAILURE_THRESHOLD,
        50,
        'CORE_AUTH_NETWORK_FAILURE_THRESHOLD',
        5,
        10_000,
      ),
      accountLockFailureThreshold: positiveInteger(
        environment.CORE_AUTH_ACCOUNT_LOCK_THRESHOLD,
        10,
        'CORE_AUTH_ACCOUNT_LOCK_THRESHOLD',
        2,
        100,
      ),
      accountLockMs:
        positiveInteger(
          environment.CORE_AUTH_ACCOUNT_LOCK_SECONDS,
          15 * 60,
          'CORE_AUTH_ACCOUNT_LOCK_SECONDS',
          30,
          86_400,
        ) * 1_000,
      passwordHistoryCount: positiveInteger(
        environment.CORE_AUTH_PASSWORD_HISTORY,
        5,
        'CORE_AUTH_PASSWORD_HISTORY',
        1,
        24,
      ),
    },
  };
}
