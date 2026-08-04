import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';

interface BearerCredential {
  readonly token: string;
  readonly notAfter?: Date;
}

interface CachedCredentialBundle {
  readonly credentials: readonly BearerCredential[];
  readonly expiresAt: number;
}

export class FileRotatingBearerTokenVerifier {
  #cache: CachedCredentialBundle | undefined;

  constructor(
    private readonly path: string,
    private readonly cacheTtlMs = 1_000,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!path.startsWith('/')) throw new Error('Rotating bearer token file path must be absolute');
    if (!Number.isInteger(cacheTtlMs) || cacheTtlMs < 0 || cacheTtlMs > 60_000)
      throw new Error('Rotating bearer token cache TTL is invalid');
  }

  async verify(candidate: string): Promise<boolean> {
    if (!candidate) return false;
    const observedAt = this.now();
    let cached = this.#cache;
    if (!cached || cached.expiresAt <= observedAt.getTime()) {
      try {
        const document = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
        cached = {
          credentials: parseBundle(document, observedAt),
          expiresAt: observedAt.getTime() + this.cacheTtlMs,
        };
        this.#cache = cached;
      } catch {
        return false;
      }
    }
    return cached.credentials.some(
      (credential) =>
        (!credential.notAfter || credential.notAfter > observedAt) &&
        constantTimeEqual(candidate, credential.token),
    );
  }
}

function parseBundle(value: unknown, now: Date): readonly BearerCredential[] {
  const record = strictRecord(value, ['active', 'retiring']);
  const active = parseCredential(record.active);
  if (active.notAfter && active.notAfter <= now)
    throw new Error('Active rotating bearer credential is expired');
  const retiring = record.retiring === undefined ? undefined : parseCredential(record.retiring);
  if (retiring && constantTimeEqual(active.token, retiring.token))
    throw new Error('Active and retiring bearer credentials must differ');
  return Object.freeze([active, ...(retiring ? [retiring] : [])]);
}

function parseCredential(value: unknown): BearerCredential {
  const record = strictRecord(value, ['version', 'token', 'notAfter']);
  if (
    typeof record.version !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.version) ||
    typeof record.token !== 'string' ||
    Buffer.byteLength(record.token, 'utf8') < 32 ||
    Buffer.byteLength(record.token, 'utf8') > 4_096
  )
    throw new Error('Rotating bearer credential is invalid');
  const notAfter =
    record.notAfter === undefined
      ? undefined
      : new Date(typeof record.notAfter === 'string' ? record.notAfter : Number.NaN);
  if (notAfter && Number.isNaN(notAfter.getTime()))
    throw new Error('Rotating bearer credential expiry is invalid');
  return Object.freeze({ token: record.token, ...(notAfter ? { notAfter } : {}) });
}

function strictRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Rotating bearer credential document is invalid');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key)))
    throw new Error('Rotating bearer credential document is invalid');
  return record;
}

function constantTimeEqual(left: string, right: string): boolean {
  const first = createHash('sha256').update(left, 'utf8').digest();
  const second = createHash('sha256').update(right, 'utf8').digest();
  return timingSafeEqual(first, second);
}
