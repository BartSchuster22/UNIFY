import type { Pool } from 'pg';
import type {
  AuthStore,
  LoginThrottle,
  NewSession,
  PrincipalRecord,
  SessionRecord,
  SessionSummary,
  UserRecord,
} from './types.js';
export class PostgresAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}
  async getTimezone(userId: string): Promise<string | null> {
    const r = await this.pool.query('SELECT timezone FROM user_time_preferences WHERE user_id=$1', [
      userId,
    ]);
    return r.rows[0]?.timezone ?? null;
  }
  async setTimezone(userId: string, timezone: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO user_time_preferences(user_id,timezone) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET timezone=EXCLUDED.timezone,updated_at=now()',
      [userId, timezone],
    );
  }
  async ready(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
  async findUserByUsername(username: string): Promise<UserRecord | null> {
    const r = await this.pool.query(
      'SELECT id, username, display_name, password_hash, status FROM users WHERE username_normalized=$1',
      [username.toLowerCase()],
    );
    const row = r.rows[0];
    return row
      ? {
          id: row.id,
          username: row.username,
          displayName: row.display_name,
          passwordHash: row.password_hash,
          status: row.status,
        }
      : null;
  }
  async getPrincipal(userId: string): Promise<PrincipalRecord | null> {
    const r = await this.pool.query(
      `SELECT u.id,u.username,u.display_name,COALESCE(array_agg(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL),'{}') roles,COALESCE(array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL),'{}') permissions FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE u.id=$1 AND u.status='active' GROUP BY u.id`,
      [userId],
    );
    const row = r.rows[0];
    return row
      ? {
          userId: row.id,
          username: row.username,
          displayName: row.display_name,
          roles: row.roles,
          permissions: row.permissions,
        }
      : null;
  }
  async getLoginThrottle(subjectHash: string): Promise<LoginThrottle | null> {
    const r = await this.pool.query(
      'SELECT failed_count,blocked_until FROM login_attempts WHERE subject_hash=$1',
      [subjectHash],
    );
    const row = r.rows[0];
    return row ? { failedCount: row.failed_count, blockedUntil: row.blocked_until } : null;
  }
  async recordLoginFailure(subjectHash: string, blockedUntil: Date | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO login_attempts(subject_hash,failed_count,first_failed_at,last_failed_at,blocked_until) VALUES($1,1,now(),now(),$2) ON CONFLICT(subject_hash) DO UPDATE SET failed_count=login_attempts.failed_count+1,last_failed_at=now(),blocked_until=$2`,
      [subjectHash, blockedUntil],
    );
  }
  async clearLoginFailures(subjectHash: string): Promise<void> {
    await this.pool.query('DELETE FROM login_attempts WHERE subject_hash=$1', [subjectHash]);
  }
  async createSession(s: NewSession): Promise<string> {
    const r = await this.pool.query(
      `INSERT INTO sessions(user_id,token_hash,csrf_hash,device_label,ip_hash,user_agent_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [s.userId, s.tokenHash, s.csrfHash, s.deviceLabel, s.ipHash, s.userAgentHash, s.expiresAt],
    );
    return r.rows[0].id;
  }
  async findActiveSession(tokenHash: string, now: Date): Promise<SessionRecord | null> {
    const r = await this.pool.query(
      `SELECT s.id session_id,s.csrf_hash,s.expires_at,u.id user_id,u.username,u.display_name,COALESCE(array_agg(DISTINCT ro.name) FILTER (WHERE ro.name IS NOT NULL),'{}') roles,COALESCE(array_agg(DISTINCT p.name) FILTER (WHERE p.name IS NOT NULL),'{}') permissions FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles ro ON ro.id=ur.role_id LEFT JOIN role_permissions rp ON rp.role_id=ro.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>$2 AND u.status='active' GROUP BY s.id,u.id`,
      [tokenHash, now],
    );
    const row = r.rows[0];
    return row
      ? {
          sessionId: row.session_id,
          csrfHash: row.csrf_hash,
          expiresAt: row.expires_at,
          userId: row.user_id,
          username: row.username,
          displayName: row.display_name,
          roles: row.roles,
          permissions: row.permissions,
        }
      : null;
  }
  async listSessions(userId: string): Promise<SessionSummary[]> {
    const r = await this.pool.query(
      'SELECT id,user_id,device_label,created_at,last_seen_at,expires_at,revoked_at FROM sessions WHERE user_id=$1 ORDER BY created_at DESC',
      [userId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      userId: x.user_id,
      deviceLabel: x.device_label,
      createdAt: x.created_at,
      lastSeenAt: x.last_seen_at,
      expiresAt: x.expires_at,
      revokedAt: x.revoked_at,
    }));
  }
  async revokeSession(sessionId: string, reason: string, now: Date): Promise<boolean> {
    const r = await this.pool.query(
      'UPDATE sessions SET revoked_at=$2,revoke_reason=$3 WHERE id=$1 AND revoked_at IS NULL',
      [sessionId, now, reason],
    );
    return (r.rowCount ?? 0) > 0;
  }
  async touchSession(sessionId: string, now: Date): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET last_seen_at=$2::timestamptz WHERE id=$1 AND last_seen_at < $2::timestamptz - interval '1 minute'`,
      [sessionId, now],
    );
  }
}
