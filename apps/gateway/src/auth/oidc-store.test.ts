import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { PostgresOidcStore } from './oidc-store.js';
function fixture(rows: unknown[] = [{ subject: 'fixture-subject', sealed: 'fixture-ciphertext' }]) {
  const query = vi.fn(async (sql: string, _parameters?: unknown[]) => ({ rows: sql.startsWith('SELECT t.subject') ? rows : [] }));
  const release = vi.fn();
  const pool = { connect: async () => ({ query, release }) } as unknown as Pool;
  return { store: new PostgresOidcStore(pool), query, release };
}
describe('transactional OIDC refresh binding', () => {
  it('locks the live session and token row and commits a rotated sealed binding', async () => {
    const f = fixture();
    await f.store.updateBinding('session-one', async () => 'rotated-ciphertext');
    const sql = f.query.mock.calls.map(([s]) => s);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[2]).toContain('s.revoked_at IS NULL');
    expect(sql[2]).toContain('s.expires_at>clock_timestamp() FOR UPDATE OF s,t');
    expect(sql[3]).toBe('UPDATE oidc_session_tokens SET sealed=$2 WHERE session_id=$1');
    expect(sql[4]).toBe('COMMIT'); expect(f.release).toHaveBeenCalledOnce();
  });
  it('does not rewrite an unchanged binding', async () => {
    const f = fixture(); await f.store.updateBinding('session-one', async b => b.sealed);
    expect(f.query.mock.calls.some(([s]) => s.startsWith('UPDATE'))).toBe(false);
    expect(f.query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
  });
  it('rejects missing/expired/revoked sessions without calling the provider', async () => {
    const f = fixture([]); const work = vi.fn(async () => 'rotated');
    await expect(f.store.updateBinding('session-one', work)).rejects.toMatchObject({ code: 'OIDC_INVALID' });
    expect(work).not.toHaveBeenCalled(); expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(f.release).toHaveBeenCalledOnce();
  });
  it('rolls back provider/storage errors without exposing error details', async () => {
    const f = fixture();
    await expect(f.store.updateBinding('session-one', async () => { throw new Error('private-error-detail'); })).rejects.toMatchObject({ message: 'OIDC authentication is invalid or expired' });
    expect(f.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(f.query.mock.calls.some(([s]) => s.startsWith('UPDATE'))).toBe(false);
  });
});
