ALTER TABLE event_cursors
  DROP CONSTRAINT IF EXISTS event_cursor_replay_state_check;

DELETE FROM role_permissions
WHERE permission_id IN (SELECT id FROM permissions WHERE name='frameworks.manage');
DELETE FROM permissions WHERE name='frameworks.manage';

DROP TABLE IF EXISTS gateway_framework_events;
