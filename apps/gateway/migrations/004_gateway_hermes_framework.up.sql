CREATE TABLE gateway_framework_events (
  framework_id text NOT NULL REFERENCES framework_registrations(id) ON DELETE CASCADE,
  source_sequence bigint NOT NULL CHECK (source_sequence >= 0),
  event_id text NOT NULL,
  event_type text NOT NULL,
  source_version text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('durable','ephemeral')),
  correlation_id text,
  operation_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (framework_id, source_sequence),
  UNIQUE (framework_id, event_id)
);

CREATE INDEX gateway_framework_events_occurred_idx
  ON gateway_framework_events(framework_id, occurred_at DESC, source_sequence DESC);

INSERT INTO permissions(name, description)
VALUES ('frameworks.manage','Execute governed framework control commands')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='Administrator' AND p.name='frameworks.manage'
ON CONFLICT DO NOTHING;

ALTER TABLE event_cursors
  ADD CONSTRAINT event_cursor_replay_state_check
    CHECK (replay_state IN ('idle','replaying','current','gap','unavailable'));
