import type { Pool } from 'pg';

export interface NotificationDraft {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  source: string;
  state: 'unread' | 'read' | 'acknowledged';
  createdAt: string;
  deepLink?: string;
  resource?: Record<string, unknown>;
}

export interface NotificationStore {
  ready(): Promise<boolean>;
  list(userId: string, allowedOwners: string[]): Promise<NotificationDraft[]>;
  sync(
    userId: string,
    notifications: NotificationDraft[],
  ): Promise<Map<string, NotificationDraft['state']>>;
  acknowledge(
    userId: string,
    notificationId: string,
    allowedOwners: string[],
  ): Promise<string | null>;
}

export class PostgresNotificationStore implements NotificationStore {
  constructor(private readonly pool: Pool) {}

  async ready(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1 FROM notifications LIMIT 1');
      return true;
    } catch {
      return false;
    }
  }

  async list(userId: string, allowedOwners: string[]): Promise<NotificationDraft[]> {
    if (allowedOwners.length === 0) return [];
    const result = await this.pool.query(
      `SELECT dedupe_key,severity,title,body,source->>'owner' owner,source->'resource' resource,
              deep_link,state,created_at
       FROM notifications
       WHERE recipient_id=$1 AND source->>'owner'=ANY($2::text[])
       ORDER BY created_at DESC,dedupe_key ASC
       LIMIT 500`,
      [userId, allowedOwners],
    );
    return result.rows.map((row) => ({
      id: String(row.dedupe_key),
      severity: row.severity as NotificationDraft['severity'],
      title: String(row.title),
      body: String(row.body),
      source: String(row.owner),
      state: row.state as NotificationDraft['state'],
      createdAt: new Date(row.created_at).toISOString(),
      ...(row.deep_link ? { deepLink: String(row.deep_link) } : {}),
      ...(row.resource && typeof row.resource === 'object'
        ? { resource: row.resource as Record<string, unknown> }
        : {}),
    }));
  }

  async sync(
    userId: string,
    notifications: NotificationDraft[],
  ): Promise<Map<string, NotificationDraft['state']>> {
    if (notifications.length === 0) return new Map();
    await this.pool.query(
      `INSERT INTO notifications(recipient_id,dedupe_key,severity,title,body,source,deep_link,state,created_at)
       SELECT $1,x.id,x.severity,x.title,x.body,jsonb_build_object('owner',x.source,'resource',x.resource),x.deep_link,x.state,x.created_at
       FROM jsonb_to_recordset($2::jsonb) AS x(id text,severity text,title text,body text,source text,resource jsonb,deep_link text,state text,created_at timestamptz)
       ON CONFLICT(recipient_id,dedupe_key) DO UPDATE SET
         severity=EXCLUDED.severity,title=EXCLUDED.title,body=EXCLUDED.body,source=EXCLUDED.source,
         deep_link=EXCLUDED.deep_link,created_at=EXCLUDED.created_at,
         state=CASE WHEN notifications.state='acknowledged' THEN notifications.state ELSE EXCLUDED.state END`,
      [
        userId,
        JSON.stringify(
          notifications.map(({ createdAt, deepLink, ...notification }) => ({
            ...notification,
            created_at: createdAt,
            deep_link: deepLink ?? null,
          })),
        ),
      ],
    );
    const result = await this.pool.query(
      'SELECT dedupe_key,state FROM notifications WHERE recipient_id=$1 AND dedupe_key=ANY($2::text[])',
      [userId, notifications.map((item) => item.id)],
    );
    return new Map(
      result.rows.map((row) => [String(row.dedupe_key), row.state as NotificationDraft['state']]),
    );
  }

  async acknowledge(
    userId: string,
    notificationId: string,
    allowedOwners: string[],
  ): Promise<string | null> {
    const result = await this.pool.query(
      `UPDATE notifications SET state='acknowledged',acknowledged_at=COALESCE(acknowledged_at,now())
       WHERE recipient_id=$1 AND dedupe_key=$2 AND source->>'owner'=ANY($3::text[]) RETURNING source->>'owner' owner`,
      [userId, notificationId, allowedOwners],
    );
    return result.rows[0]?.owner ? String(result.rows[0].owner) : null;
  }
}
