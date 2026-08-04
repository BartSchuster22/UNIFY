CREATE TABLE core.operations (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'opc')),
  command_id text NOT NULL UNIQUE CHECK (core.is_canonical_id(command_id, 'cmd')),
  command_type text NOT NULL CHECK (command_type ~ '^[a-z][a-z0-9.-]+\.v[0-9]+$'),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service')),
  actor_id text NOT NULL,
  target_kind text NOT NULL CHECK (target_kind ~ '^[a-z][a-z0-9_-]{1,63}$'),
  target_id text CHECK (target_id IS NULL OR core.is_any_canonical_id(target_id)),
  expected_resource_version bigint CHECK (expected_resource_version IS NULL OR expected_resource_version > 0),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{15,199}$'),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'running', 'succeeded', 'failed', 'cancelled')),
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error jsonb CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT operations_actor CHECK (core.is_principal_id(actor_kind, actor_id)),
  CONSTRAINT operations_terminal_shape CHECK (
    (status IN ('accepted', 'running') AND finished_at IS NULL) OR
    (status = 'succeeded' AND finished_at IS NOT NULL AND result IS NOT NULL AND error IS NULL) OR
    (status = 'failed' AND finished_at IS NOT NULL AND error IS NOT NULL) OR
    (status = 'cancelled' AND finished_at IS NOT NULL)
  ),
  CONSTRAINT operations_started CHECK (started_at IS NULL OR started_at >= accepted_at),
  CONSTRAINT operations_finished CHECK (finished_at IS NULL OR finished_at >= accepted_at),
  UNIQUE (actor_kind, actor_id, idempotency_key)
);
CREATE OR REPLACE FUNCTION core.validate_operation_actor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT core.principal_exists(NEW.actor_kind, NEW.actor_id) THEN
    RAISE EXCEPTION 'operation actor does not exist' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER operations_validate_actor BEFORE INSERT OR UPDATE ON core.operations
FOR EACH ROW EXECUTE FUNCTION core.validate_operation_actor();
CREATE INDEX operations_dispatch
  ON core.operations (accepted_at, id)
  WHERE status = 'accepted';
CREATE INDEX operations_by_target
  ON core.operations (target_kind, target_id, accepted_at DESC);
CREATE TRIGGER operations_bump_version BEFORE UPDATE ON core.operations
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.operation_attempts (
  operation_id text NOT NULL REFERENCES core.operations(id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed', 'cancelled', 'timed_out')),
  safe_error jsonb CHECK (safe_error IS NULL OR jsonb_typeof(safe_error) = 'object'),
  PRIMARY KEY (operation_id, attempt),
  CONSTRAINT operation_attempt_finished CHECK (
    (finished_at IS NULL AND outcome IS NULL) OR
    (finished_at IS NOT NULL AND finished_at >= started_at AND outcome IS NOT NULL)
  )
);

CREATE TABLE core.aggregate_sequences (
  aggregate_kind text NOT NULL CHECK (aggregate_kind ~ '^[a-z][a-z0-9_-]{1,63}$'),
  aggregate_id text NOT NULL CHECK (core.is_any_canonical_id(aggregate_id)),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  PRIMARY KEY (aggregate_kind, aggregate_id)
);

CREATE OR REPLACE FUNCTION core.next_event_sequence(kind text, id text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  value bigint;
BEGIN
  IF kind !~ '^[a-z][a-z0-9_-]{1,63}$' OR NOT core.is_any_canonical_id(id) THEN
    RAISE EXCEPTION 'invalid event aggregate' USING ERRCODE = '22023';
  END IF;
  INSERT INTO core.aggregate_sequences (aggregate_kind, aggregate_id, last_sequence)
  VALUES (kind, id, 1)
  ON CONFLICT (aggregate_kind, aggregate_id)
  DO UPDATE SET last_sequence = core.aggregate_sequences.last_sequence + 1
  RETURNING last_sequence INTO value;
  RETURN value;
END;
$$;

CREATE OR REPLACE FUNCTION core.assign_event_sequence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.aggregate_sequence IS NOT NULL THEN
    RAISE EXCEPTION 'event aggregate sequence is managed by the database'
      USING ERRCODE = '55000';
  END IF;
  NEW.aggregate_sequence := core.next_event_sequence(NEW.aggregate_kind, NEW.aggregate_id);
  RETURN NEW;
END;
$$;

CREATE TABLE core.events (
  global_position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'evt')),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9.-]+\.v[0-9]+$'),
  aggregate_kind text NOT NULL CHECK (aggregate_kind ~ '^[a-z][a-z0-9_-]{1,63}$'),
  aggregate_id text NOT NULL CHECK (core.is_any_canonical_id(aggregate_id)),
  aggregate_sequence bigint NOT NULL CHECK (aggregate_sequence > 0),
  operation_id text REFERENCES core.operations(id) ON DELETE SET NULL,
  correlation_id text NOT NULL CHECK (core.is_canonical_id(correlation_id, 'cor')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (aggregate_kind, aggregate_id, aggregate_sequence),
  CONSTRAINT events_recorded_after_occurrence CHECK (recorded_at >= occurred_at)
);
CREATE INDEX events_aggregate_history
  ON core.events (aggregate_kind, aggregate_id, aggregate_sequence);
CREATE TRIGGER events_assign_sequence BEFORE INSERT ON core.events
FOR EACH ROW EXECUTE FUNCTION core.assign_event_sequence();
CREATE TRIGGER events_immutable
BEFORE UPDATE OR DELETE ON core.events
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.event_publications (
  event_id text PRIMARY KEY REFERENCES core.events(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'publishing', 'published', 'failed')),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  published_at timestamptz,
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT event_publication_terminal CHECK (
    (status = 'published' AND published_at IS NOT NULL AND safe_error_code IS NULL) OR
    (status <> 'published' AND published_at IS NULL)
  )
);
CREATE INDEX event_publications_queue
  ON core.event_publications (available_at, event_id)
  WHERE status IN ('pending', 'failed');
CREATE TRIGGER event_publications_bump_version BEFORE UPDATE ON core.event_publications
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.event_consumers (
  consumer_key text PRIMARY KEY CHECK (consumer_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  cursor_position bigint NOT NULL DEFAULT 0 CHECK (cursor_position >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT event_consumer_lease CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL) OR
    (lease_owner IS NOT NULL AND length(lease_owner) BETWEEN 1 AND 200 AND lease_expires_at IS NOT NULL)
  )
);

CREATE OR REPLACE FUNCTION core.protect_event_cursor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_head bigint;
BEGIN
  SELECT coalesce(max(global_position), 0) INTO event_head FROM core.events;
  IF NEW.cursor_position > event_head THEN
    RAISE EXCEPTION 'event cursor % exceeds durable event head %', NEW.cursor_position, event_head
      USING ERRCODE = '22023';
  END IF;
  IF NEW.cursor_position < OLD.cursor_position THEN
    RAISE EXCEPTION 'event cursor regression from % to %', OLD.cursor_position, NEW.cursor_position
      USING ERRCODE = '40001';
  END IF;
  IF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'event consumer version is managed by the database'
      USING ERRCODE = '40001';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER event_consumers_protect_cursor BEFORE UPDATE ON core.event_consumers
FOR EACH ROW EXECUTE FUNCTION core.protect_event_cursor();

CREATE TABLE core.inbound_receipts (
  source_framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE CASCADE,
  source_event_id text NOT NULL CHECK (length(source_event_id) BETWEEN 1 AND 300),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  operation_id text REFERENCES core.operations(id) ON DELETE SET NULL,
  PRIMARY KEY (source_framework_id, source_event_id)
);
CREATE TRIGGER inbound_receipts_immutable
BEFORE UPDATE OR DELETE ON core.inbound_receipts
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
