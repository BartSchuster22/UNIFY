import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import argon2 from 'argon2';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOKEN_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface Argon2idPolicy {
  readonly memoryCostKiB: number;
  readonly timeCost: number;
  readonly parallelism: number;
  readonly hashLength: number;
}

export const PRODUCTION_ARGON2ID_POLICY: Argon2idPolicy = Object.freeze({
  memoryCostKiB: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

export interface PasswordValidationResult {
  readonly valid: boolean;
  readonly violations: readonly string[];
}

export function validatePassword(password: string, username: string): PasswordValidationResult {
  const violations: string[] = [];
  if (password.length < 16) violations.push('minimum-length');
  if (Buffer.byteLength(password, 'utf8') > 1_024) violations.push('maximum-length');
  const classes = [/[a-z]/u, /[A-Z]/u, /[0-9]/u, /[^A-Za-z0-9]/u].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (classes < 3) violations.push('character-diversity');
  const normalizedPassword = password.normalize('NFKC').toLowerCase();
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername.length >= 3 && normalizedPassword.includes(normalizedUsername))
    violations.push('contains-username');
  if (new Set(normalizedPassword).size < 8) violations.push('insufficient-variation');
  return { valid: violations.length === 0, violations };
}

export class PasswordHasher {
  readonly #pepper: Buffer;
  readonly #policy: Argon2idPolicy;

  constructor(pepper: string, policy: Argon2idPolicy = PRODUCTION_ARGON2ID_POLICY) {
    if (Buffer.byteLength(pepper, 'utf8') < 32)
      throw new Error('Password pepper must contain at least 32 bytes');
    if (!Number.isInteger(policy.memoryCostKiB) || policy.memoryCostKiB < 8_192)
      throw new Error('Argon2id memory cost must be at least 8192 KiB');
    if (!Number.isInteger(policy.timeCost) || policy.timeCost < 2)
      throw new Error('Argon2id time cost must be at least 2');
    if (!Number.isInteger(policy.parallelism) || policy.parallelism < 1)
      throw new Error('Argon2id parallelism must be positive');
    if (!Number.isInteger(policy.hashLength) || policy.hashLength < 32)
      throw new Error('Argon2id hash length must be at least 32 bytes');
    this.#pepper = Buffer.from(pepper, 'utf8');
    this.#policy = policy;
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: this.#policy.memoryCostKiB,
      timeCost: this.#policy.timeCost,
      parallelism: this.#policy.parallelism,
      hashLength: this.#policy.hashLength,
      secret: this.#pepper,
    });
  }

  async verify(encoded: string, password: string): Promise<boolean> {
    if (!encoded.startsWith('$argon2id$')) return false;
    try {
      return await argon2.verify(encoded, password, { secret: this.#pepper });
    } catch {
      return false;
    }
  }

  needsRehash(encoded: string): boolean {
    try {
      return argon2.needsRehash(encoded, {
        memoryCost: this.#policy.memoryCostKiB,
        timeCost: this.#policy.timeCost,
        parallelism: this.#policy.parallelism,
      });
    } catch {
      return true;
    }
  }
}

export function normalizeUsername(value: string): string {
  return value.trim().normalize('NFKC').toLowerCase();
}

export function opaqueSecret(bytes = 32): string {
  if (bytes < 32) throw new Error('Opaque secrets require at least 256 bits');
  return randomBytes(bytes).toString('base64url');
}

export function digestSecret(value: string, pepper: string): Buffer {
  if (Buffer.byteLength(pepper, 'utf8') < 32)
    throw new Error('Token pepper must contain at least 32 bytes');
  return createHmac('sha256', pepper).update(value, 'utf8').digest();
}

export function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function safeStringEqual(left: string, right: string): boolean {
  const leftDigest = createHmac('sha256', 'unify-core-constant-time-comparison')
    .update(left)
    .digest();
  const rightDigest = createHmac('sha256', 'unify-core-constant-time-comparison')
    .update(right)
    .digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function formatOpaqueCredential(id: string, secret: string): string {
  if (!TOKEN_SECRET_PATTERN.test(secret)) throw new Error('Invalid opaque credential secret');
  return `${id}.${secret}`;
}

export function parseOpaqueCredential(
  value: string,
  expectedPrefix: string,
): { id: string; secret: string } | null {
  const separator = value.indexOf('.');
  if (separator < 1 || value.indexOf('.', separator + 1) !== -1) return null;
  const id = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  const idPattern = new RegExp(`^${expectedPrefix}_[0-9A-HJKMNP-TV-Z]{26}$`);
  if (!idPattern.test(id) || !TOKEN_SECRET_PATTERN.test(secret)) return null;
  return { id, secret };
}

export function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let output = '';
  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/u, '');
  let bits = 0;
  let accumulator = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 value');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

export function totpCode(
  secret: string,
  observedAt = new Date(),
  stepSeconds = 30,
  digits = 6,
): string {
  const counter = BigInt(Math.floor(observedAt.getTime() / 1000 / stepSeconds));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function verifyTotpCounter(
  secret: string,
  supplied: string,
  observedAt = new Date(),
  window = 1,
): bigint | null {
  if (!/^[0-9]{6}$/u.test(supplied)) return null;
  const observedCounter = BigInt(Math.floor(observedAt.getTime() / 30_000));
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateCounter = observedCounter + BigInt(offset);
    if (candidateCounter < 0n) continue;
    const candidate = totpCode(secret, new Date(Number(candidateCounter) * 30_000));
    if (safeStringEqual(candidate, supplied)) return candidateCounter;
  }
  return null;
}

export function verifyTotp(
  secret: string,
  supplied: string,
  observedAt = new Date(),
  window = 1,
): boolean {
  return verifyTotpCounter(secret, supplied, observedAt, window) !== null;
}

export function provisioningUri(issuer: string, username: string, secret: string): string {
  const label = `${issuer}:${username}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function generateRecoveryCodes(count = 10): readonly string[] {
  if (count < 8 || count > 20) throw new Error('Recovery code count must be from 8 to 20');
  return Array.from({ length: count }, () => {
    const raw = encodeBase32(randomBytes(10)).slice(0, 16);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
  });
}

export function normalizeRecoveryCode(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/gu, '');
}

export function encryptMfaSecret(secret: string, key: Buffer): Buffer {
  if (key.length !== 32) throw new Error('MFA encryption key must contain 32 bytes');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), nonce, tag, ciphertext]);
}

export function decryptMfaSecret(envelope: Buffer, key: Buffer): string {
  if (key.length !== 32 || envelope.length < 30 || envelope[0] !== 1)
    throw new Error('Invalid MFA secret envelope');
  const nonce = envelope.subarray(1, 13);
  const tag = envelope.subarray(13, 29);
  const ciphertext = envelope.subarray(29);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
