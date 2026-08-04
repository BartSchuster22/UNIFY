import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  FrameworkGatewayError,
  type GatewayCredential,
  type GatewayCredentialBundle,
  type GatewayCredentialProvider,
} from './types.js';

interface CacheEntry {
  readonly bundle: GatewayCredentialBundle;
  readonly expiresAt: number;
}

export class FileGatewayCredentialProvider implements GatewayCredentialProvider {
  readonly #cache = new Map<string, CacheEntry>();

  constructor(
    private readonly secretRoot: string,
    private readonly cacheTtlMs = 5_000,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!secretRoot.startsWith('/')) throw new Error('Gateway secret root must be absolute');
    if (cacheTtlMs < 0 || cacheTtlMs > 60_000)
      throw new Error('Gateway credential cache TTL is invalid');
  }

  async resolve(reference: string, forceRefresh = false): Promise<GatewayCredentialBundle> {
    const current = this.#cache.get(reference);
    const now = this.now().getTime();
    if (!forceRefresh && current && current.expiresAt > now) return current.bundle;

    const path = referencePath(this.secretRoot, reference);
    let decoded: unknown;
    try {
      decoded = JSON.parse(await readFile(path, 'utf8')) as unknown;
    } catch {
      throw new FrameworkGatewayError(
        'framework_credential_unavailable',
        'Framework credential is unavailable',
        true,
      );
    }
    const bundle = parseCredentialBundle(decoded, this.now());
    this.#cache.set(reference, { bundle, expiresAt: now + this.cacheTtlMs });
    return bundle;
  }
}

export function parseCredentialBundle(value: unknown, now = new Date()): GatewayCredentialBundle {
  const record = strictRecord(value, ['active', 'retiring']);
  const active = parseCredential(record.active, now, false);
  const retiring = record.retiring ? parseCredential(record.retiring, now, true) : undefined;
  if (retiring && retiring.version === active.version)
    throw new FrameworkGatewayError(
      'framework_credential_invalid',
      'Active and retiring credential versions must differ',
      false,
      422,
    );
  if (retiring && retiring.token === active.token)
    throw new FrameworkGatewayError(
      'framework_credential_invalid',
      'Active and retiring credentials must differ',
      false,
      422,
    );
  return Object.freeze({ active, ...(retiring ? { retiring } : {}) });
}

function parseCredential(value: unknown, now: Date, allowExpired: boolean): GatewayCredential {
  const record = strictRecord(value, ['version', 'token', 'notAfter']);
  const version = requiredString(record.version, 1, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(version)) throw invalidCredential();
  const token = requiredString(record.token, 32, 4_096);
  const notAfter =
    record.notAfter === undefined ? undefined : new Date(requiredString(record.notAfter, 1, 100));
  if (notAfter && Number.isNaN(notAfter.getTime())) throw invalidCredential();
  if (!allowExpired && notAfter && notAfter <= now)
    throw new FrameworkGatewayError(
      'framework_credential_expired',
      'Active framework credential has expired',
      false,
      503,
    );
  if (allowExpired && notAfter && notAfter <= now)
    return Object.freeze({ version, token, notAfter });
  return Object.freeze({ version, token, ...(notAfter ? { notAfter } : {}) });
}

function referencePath(root: string, reference: string): string {
  let parsed: URL;
  try {
    parsed = new URL(reference);
  } catch {
    throw invalidCredential();
  }
  if (parsed.protocol !== 'secret:' || !parsed.hostname || parsed.search || parsed.hash)
    throw invalidCredential();
  const segments = [parsed.hostname, ...parsed.pathname.split('/').filter(Boolean)];
  if (
    segments.some(
      (segment) => !/^[A-Za-z0-9._-]+$/u.test(segment) || segment === '.' || segment === '..',
    )
  )
    throw invalidCredential();
  const rootPath = resolve(root);
  const path = resolve(rootPath, ...segments) + '.json';
  if (!path.startsWith(`${rootPath}${sep}`)) throw invalidCredential();
  return path;
}

function strictRecord(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidCredential();
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !allowed.includes(key))) throw invalidCredential();
  return record;
}

function requiredString(value: unknown, minimum: number, maximum: number): string {
  const bytes = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
  if (typeof value !== 'string' || bytes < minimum || bytes > maximum) throw invalidCredential();
  return value;
}

function invalidCredential(): FrameworkGatewayError {
  return new FrameworkGatewayError(
    'framework_credential_invalid',
    'Framework credential document is invalid',
    false,
    422,
  );
}
