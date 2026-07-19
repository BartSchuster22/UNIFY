import { createHash } from 'node:crypto';
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}
function normalize(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers');
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    );
  throw new TypeError(`Canonical JSON rejects ${typeof value}`);
}
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
const SENSITIVE =
  /(authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|private[-_]?key)/i;
export function redactEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        SENSITIVE.test(key) ? '[REDACTED]' : redactEvidence(item),
      ]),
    );
  return value;
}
