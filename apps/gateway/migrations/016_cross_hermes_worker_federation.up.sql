CREATE TABLE federation_worker_leases (
  id uuid PRIMARY KEY,
  source_framework_id text NOT NULL CHECK (source_framework_id = 'hermes-alica'),
  source_board_id text NOT NULL CHECK (length(source_board_id) BETWEEN 1 AND 200),
  source_task_id text NOT NULL CHECK (length(source_task_id) BETWEEN 1 AND 300),
  worker_framework_id text NOT NULL CHECK (worker_framework_id = 'hermes-herman'),
  worker_board_id text NOT NULL CHECK (length(worker_board_id) BETWEEN 1 AND 200),
  worker_profile_id text NOT NULL CHECK (length(worker_profile_id) BETWEEN 1 AND 200),
  worker_task_id text CHECK (worker_task_id IS NULL OR length(worker_task_id) BETWEEN 1 AND 300),
  status text NOT NULL CHECK (status IN ('pending','running','completed','failed')),
  stage text NOT NULL CHECK (stage IN ('pending','source-started','worker-completed','source-completed','source-blocked')),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  lease_expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb,
  error jsonb,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT federation_distinct_frameworks CHECK (source_framework_id <> worker_framework_id),
  CONSTRAINT federation_one_worker_per_source UNIQUE (source_framework_id, source_board_id, source_task_id)
);

CREATE INDEX federation_worker_leases_status_expiry_idx
  ON federation_worker_leases(status, lease_expires_at);

CREATE TABLE federation_worker_lease_events (
  id bigserial PRIMARY KEY,
  lease_id uuid NOT NULL REFERENCES federation_worker_leases(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 200),
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_federation_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_framework_id <> OLD.source_framework_id
     OR NEW.source_board_id <> OLD.source_board_id
     OR NEW.source_task_id <> OLD.source_task_id
     OR NEW.worker_framework_id <> OLD.worker_framework_id
     OR NEW.worker_board_id <> OLD.worker_board_id
     OR NEW.worker_profile_id <> OLD.worker_profile_id
     OR NEW.request_hash <> OLD.request_hash
     OR NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'federation worker lease identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER federation_worker_lease_identity_immutable
  BEFORE UPDATE ON federation_worker_leases
  FOR EACH ROW EXECUTE FUNCTION prevent_federation_identity_mutation();

CREATE OR REPLACE FUNCTION prevent_federation_event_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'federation worker lease evidence is immutable';
END;
$$;

CREATE TRIGGER federation_worker_lease_event_immutable
  BEFORE UPDATE OR DELETE ON federation_worker_lease_events
  FOR EACH ROW EXECUTE FUNCTION prevent_federation_event_mutation();

GRANT SELECT, INSERT, UPDATE ON federation_worker_leases TO gateway_runtime;
GRANT SELECT, INSERT ON federation_worker_lease_events TO gateway_runtime;
GRANT USAGE, SELECT ON SEQUENCE federation_worker_lease_events_id_seq TO gateway_runtime;
