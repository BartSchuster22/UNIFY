import { open, constants } from 'node:fs/promises';
import { AuthError } from '../auth/service.js';

/** Host-owned, read-only report. No Docker socket, broker socket or recovery authority. */
export async function readOperations(path: string, cell: string, now = Date.now()) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('invalid-report');
    const report = JSON.parse(await file.readFile('utf8')) as Record<string, unknown>;
    const snapshot = report.snapshot as Record<string, unknown> | undefined;
    if (report.schema !== 'alica-operations/v1' || report.owner !== 'doghouse-dsh' ||
        !snapshot || snapshot.cell !== cell || typeof report.observedAt !== 'number' ||
        !Number.isFinite(report.observedAt) || !Array.isArray(report.incidents) || !Array.isArray(report.audit))
      throw new Error('invalid-report');
    const ageSeconds = now / 1000 - report.observedAt;
    return { ...report, stale: ageSeconds < 0 || ageSeconds > 20, ageSeconds,
      authority: 'read-only; privileged recovery is host-local and broker-checked' };
  } catch {
    throw new AuthError('OPERATIONS_UNAVAILABLE', 503, 'Host operations report unavailable or invalid');
  } finally {
    await file?.close();
  }
}
