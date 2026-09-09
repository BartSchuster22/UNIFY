import { randomUUID, createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { AuthError } from './service.js';
import type { OidcIdentity, OidcStore } from './oidc.js';
export class PostgresOidcStore implements OidcStore {
  constructor(private readonly pool: Pool) {}
  async putFlow(hash: string, sealed: string, expiresAt: Date): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(73912064)');
      await c.query('DELETE FROM oidc_flows WHERE expires_at <= now()');
      const inserted = await c.query(
        'INSERT INTO oidc_flows(state_hash,sealed,expires_at) SELECT $1,$2,$3 WHERE (SELECT count(*) FROM oidc_flows)<10000 RETURNING state_hash',
        [hash, sealed, expiresAt],
      );
      if (!inserted.rowCount) throw new AuthError('OIDC_BUSY', 429, 'Login capacity reached');
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async consumeFlow(hash: string): Promise<string | null> {
    const result = await this.pool.query(
      'DELETE FROM oidc_flows WHERE state_hash=$1 RETURNING sealed,expires_at',
      [hash],
    );
    const r = result.rows[0];
    return r && new Date(r.expires_at).getTime() > Date.now() ? r.sealed : null;
  }
  async resolveIdentity(identity: OidcIdentity): Promise<string> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        createHash('sha256')
          .update(JSON.stringify([identity.issuer, identity.subject]))
          .digest('hex'),
      ]);
      const existing = await c.query(
        'SELECT user_id FROM oidc_identities WHERE issuer=$1 AND subject=$2',
        [identity.issuer, identity.subject],
      );
      let userId: string | undefined = existing.rows[0]?.user_id;
      if (!userId) {
        const made = await c.query(
          "INSERT INTO users(username,display_name,password_hash) VALUES($1,$2,'!oidc:no-local-password') RETURNING id",
          ['oidc-' + randomUUID(), identity.displayName],
        );
        userId = made.rows[0].id as string;
        await c.query('INSERT INTO oidc_identities(issuer,subject,user_id) VALUES($1,$2,$3)', [
          identity.issuer,
          identity.subject,
          userId,
        ]);
      }
      const active = await c.query(
        "UPDATE users SET display_name=$2,updated_at=now() WHERE id=$1 AND status='active' RETURNING id",
        [userId, identity.displayName],
      );
      if (!active.rowCount) throw new AuthError('OIDC_NOT_ADMITTED', 403, 'Identity is disabled');
      await c.query('DELETE FROM user_roles WHERE user_id=$1', [userId]);
      await c.query(
        'INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=ANY($2::text[])',
        [userId, identity.roles],
      );
      await c.query('COMMIT');
      return userId;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async bindSession(sessionId: string, subject: string, sealed: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO oidc_session_tokens(session_id,subject,sealed) VALUES($1,$2,$3)',
      [sessionId, subject, sealed],
    );
  }
  async sessionBinding(sessionId: string): Promise<{ subject: string; sealed: string } | null> {
    const result = await this.pool.query(
      'SELECT subject,sealed FROM oidc_session_tokens t JOIN sessions s ON s.id=t.session_id WHERE t.session_id=$1 AND s.revoked_at IS NULL AND s.expires_at>now()',
      [sessionId],
    );
    return result.rows[0] ?? null;
  }
}
