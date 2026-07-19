import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

function derive(
  password: string,
  salt: Buffer,
  length: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, length, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}
const KEY_LENGTH = 32;
const N = 16384;
const R = 8;
const P = 1;
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}
export async function hashPassword(password: string, pepper = ''): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(`${password}${pepper}`, salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$v1$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(
  password: string,
  encoded: string,
  pepper = '',
): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 7 || parts[0] !== 'scrypt' || parts[1] !== 'v1') return false;
  const [, , nText, rText, pText, saltText, keyText] = parts;
  if (!nText || !rText || !pText || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, 'base64url');
  const actual = await derive(
    `${password}${pepper}`,
    Buffer.from(saltText, 'base64url'),
    expected.length,
    { N: Number(nText), r: Number(rText), p: Number(pText), maxmem: 64 * 1024 * 1024 },
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
