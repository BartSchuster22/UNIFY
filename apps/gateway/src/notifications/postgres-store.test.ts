import { describe, expect, it, vi } from 'vitest';
import { PostgresNotificationStore, type NotificationDraft } from './postgres-store.js';

const draft: NotificationDraft = {
  id: 'notice-1',
  severity: 'warning',
  title: 'Attention',
  body: 'Owner needs attention',
  source: 'agency',
  state: 'unread',
  createdAt: '2026-07-19T12:00:00.000Z',
  deepLink: '/?view=notifications',
};

describe('PostgresNotificationStore', () => {
  it('syncs recipient-scoped notifications and returns persisted state', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ dedupe_key: 'notice-1', state: 'acknowledged' }] });
    const store = new PostgresNotificationStore({ query } as never);
    const states = await store.sync('user-1', [draft]);
    expect(states.get('notice-1')).toBe('acknowledged');
    expect(query.mock.calls[0]?.[1]).toEqual([
      'user-1',
      JSON.stringify([
        {
          id: draft.id,
          severity: draft.severity,
          title: draft.title,
          body: draft.body,
          source: draft.source,
          state: draft.state,
          created_at: draft.createdAt,
          deep_link: draft.deepLink,
        },
      ]),
    ]);
    expect(String(query.mock.calls[0]?.[0])).toContain(
      "state=CASE WHEN notifications.state='acknowledged'",
    );
  });

  it('acknowledges only records owned by a currently allowed owner', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ owner: 'agency' }] });
    const store = new PostgresNotificationStore({ query } as never);
    await expect(store.acknowledge('user-1', 'notice-1', ['agency'])).resolves.toBe('agency');
    expect(query.mock.calls[0]?.[1]).toEqual(['user-1', 'notice-1', ['agency']]);
    expect(String(query.mock.calls[0]?.[0])).toContain("source->>'owner'=ANY");
  });

  it('reports an inaccessible or missing notification without mutating another recipient', async () => {
    const store = new PostgresNotificationStore({
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as never);
    await expect(store.acknowledge('user-2', 'notice-1', [])).resolves.toBeNull();
  });
});
