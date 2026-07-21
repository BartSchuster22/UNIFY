CREATE TABLE hermes_adapter_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  framework_id text NOT NULL,
  event_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  family text NOT NULL CHECK (family IN ('profiles','providers','work','conversations')),
  event_type text NOT NULL,
  source_version text NOT NULL,
  correlation_id text NOT NULL,
  operation_id text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (framework_id, family, source_version)
);
CREATE INDEX hermes_adapter_events_replay_idx
  ON hermes_adapter_events(framework_id, sequence);

CREATE TABLE hermes_adapter_idempotency (
  framework_id text NOT NULL,
  capability text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  command_body jsonb NOT NULL,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (framework_id, capability, idempotency_key),
  CHECK (expires_at > created_at)
);
CREATE INDEX hermes_adapter_idempotency_expiry_idx
  ON hermes_adapter_idempotency(expires_at);

CREATE TABLE hermes_adapter_audit (
  sequence bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  framework_id text NOT NULL,
  event_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','failure','inconclusive')),
  request_id text NOT NULL,
  correlation_id text NOT NULL,
  actor_type text,
  actor_id text,
  operation_id text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash text,
  event_hash text NOT NULL UNIQUE CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hermes_adapter_audit_replay_idx
  ON hermes_adapter_audit(framework_id, sequence);
