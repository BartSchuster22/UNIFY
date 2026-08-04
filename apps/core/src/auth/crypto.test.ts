import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PasswordHasher,
  PRODUCTION_ARGON2ID_POLICY,
  decryptMfaSecret,
  digestSecret,
  encryptMfaSecret,
  formatOpaqueCredential,
  normalizeRecoveryCode,
  parseOpaqueCredential,
  safeEqual,
  totpCode,
  validatePassword,
  verifyTotp,
} from './crypto.js';
import { authenticationConfigFromEnvironment } from './config.js';

const TEST_PEPPER = 'password-pepper-that-is-at-least-thirty-two-bytes';

test('Argon2id password hashes are peppered and policy-bound', async () => {
  const hasher = new PasswordHasher(TEST_PEPPER, {
    ...PRODUCTION_ARGON2ID_POLICY,
    memoryCostKiB: 8_192,
    timeCost: 2,
  });
  const encoded = await hasher.hash('A-strong-password-2026!');
  assert.match(encoded, /^\$argon2id\$v=19\$/);
  assert.match(encoded, /m=8192/);
  assert.match(encoded, /p=1/);
  assert.match(encoded, /t=2/);
  assert.equal(await hasher.verify(encoded, 'A-strong-password-2026!'), true);
  assert.equal(await hasher.verify(encoded, 'A-strong-password-2026?'), false);
  const otherPepper = new PasswordHasher(`${TEST_PEPPER}-different`, {
    ...PRODUCTION_ARGON2ID_POLICY,
    memoryCostKiB: 8_192,
    timeCost: 2,
  });
  assert.equal(await otherPepper.verify(encoded, 'A-strong-password-2026!'), false);
  assert.equal(hasher.needsRehash(encoded), false);
});

test('password policy rejects weak, oversized, and username-derived passwords', () => {
  assert.equal(validatePassword('short', 'administrator').valid, false);
  assert.equal(validatePassword('administrator-Strong-2026!', 'administrator').valid, false);
  assert.equal(validatePassword('A'.repeat(1_025), 'administrator').valid, false);
  assert.deepEqual(validatePassword('Correct-Horse-2026!', 'administrator'), {
    valid: true,
    violations: [],
  });
});

test('opaque credentials, HMAC digests, and constant-time comparison round trip', () => {
  const token = formatOpaqueCredential('ses_01ARZ3NDEKTSV4RRFFQ69G5FAV', 'q'.repeat(43));
  assert.deepEqual(parseOpaqueCredential(token, 'ses'), {
    id: 'ses_01ARZ3NDEKTSV4RRFFQ69G5FAV',
    secret: 'q'.repeat(43),
  });
  assert.equal(parseOpaqueCredential(`${token}.extra`, 'ses'), null);
  assert.equal(parseOpaqueCredential(token, 'crd'), null);
  const one = digestSecret(token, TEST_PEPPER);
  const two = digestSecret(token, TEST_PEPPER);
  assert.equal(safeEqual(one, two), true);
  two[0] = two[0]! ^ 1;
  assert.equal(safeEqual(one, two), false);
});

test('RFC 6238 TOTP vectors, recovery normalization, and AES-GCM MFA encryption', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const at59Seconds = new Date(59_000);
  assert.equal(totpCode(secret, at59Seconds, 30, 8), '94287082');
  assert.equal(verifyTotp(secret, totpCode(secret, at59Seconds), at59Seconds), true);
  assert.equal(verifyTotp(secret, '000000', at59Seconds), false);
  assert.equal(normalizeRecoveryCode(' abcd-1234-efgh '), 'ABCD1234EFGH');

  const key = Buffer.alloc(32, 7);
  const encrypted = encryptMfaSecret(secret, key);
  assert.notEqual(encrypted.toString('utf8'), secret);
  assert.equal(decryptMfaSecret(encrypted, key), secret);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
  assert.throws(() => decryptMfaSecret(tampered, key));
});

test('authentication environment parsing is strict and production Argon2id defaults are retained', () => {
  const encodedKey = Buffer.alloc(32, 9).toString('base64');
  const config = authenticationConfigFromEnvironment({
    CORE_AUTH_PASSWORD_PEPPER: TEST_PEPPER,
    CORE_AUTH_TOKEN_PEPPER: 'token-pepper-that-is-also-at-least-thirty-two-bytes',
    CORE_AUTH_MFA_KEY_BASE64: encodedKey,
    CORE_AUTH_BOOTSTRAP_TOKEN: 'bootstrap-token-that-is-at-least-thirty-two-bytes',
  });
  assert.equal(config.policy.argon2id.memoryCostKiB, 65_536);
  assert.equal(config.policy.argon2id.timeCost, 3);
  assert.equal(config.policy.argon2id.parallelism, 1);
  assert.equal(config.mfaEncryptionKeys.get(1)?.equals(Buffer.alloc(32, 9)), true);
  const rotated = authenticationConfigFromEnvironment({
    CORE_AUTH_PASSWORD_PEPPER: TEST_PEPPER,
    CORE_AUTH_TOKEN_PEPPER: 'token-pepper-that-is-also-at-least-thirty-two-bytes',
    CORE_AUTH_MFA_KEY_VERSION: '2',
    CORE_AUTH_MFA_KEYS_JSON: JSON.stringify({
      1: encodedKey,
      2: Buffer.alloc(32, 7).toString('base64'),
    }),
  });
  assert.equal(rotated.mfaEncryptionKeys.size, 2);
  assert.equal(rotated.mfaEncryptionKeys.get(2)?.equals(Buffer.alloc(32, 7)), true);
  assert.throws(
    () =>
      authenticationConfigFromEnvironment({
        CORE_AUTH_PASSWORD_PEPPER: TEST_PEPPER,
        CORE_AUTH_TOKEN_PEPPER: 'token-pepper-that-is-also-at-least-thirty-two-bytes',
        CORE_AUTH_MFA_KEY_VERSION: '2',
        CORE_AUTH_MFA_KEYS_JSON: JSON.stringify({ 1: encodedKey }),
      }),
    /does not contain/,
  );
  assert.throws(
    () =>
      authenticationConfigFromEnvironment({
        CORE_AUTH_PASSWORD_PEPPER: TEST_PEPPER,
        CORE_AUTH_TOKEN_PEPPER: 'token-pepper-that-is-also-at-least-thirty-two-bytes',
        CORE_AUTH_MFA_KEY_BASE64: encodedKey,
        CORE_AUTH_BOOTSTRAP_TOKEN: 'short',
      }),
    /CORE_AUTH_BOOTSTRAP_TOKEN must contain at least 32 bytes/,
  );
  assert.throws(
    () => authenticationConfigFromEnvironment({ CORE_AUTH_PASSWORD_PEPPER: 'short' }),
    /at least 32/,
  );
});
