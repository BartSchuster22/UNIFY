CREATE TABLE core.notifications (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'ntf')),
  recipient_kind text NOT NULL CHECK (recipient_kind IN ('user', 'service')),
  recipient_id text NOT NULL,
  category text NOT NULL CHECK (category ~ '^[a-z][a-z0-9._-]{1,127}$'),
  severity text NOT NULL CHECK (severity IN ('info', 'success', 'warning', 'error')),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  action_url text CHECK (action_url IS NULL OR action_url ~ '^/[A-Za-z0-9/_?&=.-]*$'),
  operation_id text REFERENCES core.operations(id) ON DELETE SET NULL,
  source_event_id text REFERENCES core.events(id) ON DELETE SET NULL,
  deduplication_key text CHECK (deduplication_key IS NULL OR deduplication_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  state text NOT NULL DEFAULT 'unread' CHECK (state IN ('unread', 'read', 'archived')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  read_at timestamptz,
  archived_at timestamptz,
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT notifications_recipient CHECK (core.is_principal_id(recipient_kind, recipient_id)),
  CONSTRAINT notifications_state_times CHECK (
    (state = 'unread' AND read_at IS NULL AND archived_at IS NULL) OR
    (state = 'read' AND read_at IS NOT NULL AND archived_at IS NULL) OR
    (state = 'archived' AND archived_at IS NOT NULL)
  ),
  CONSTRAINT notifications_expiry CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE OR REPLACE FUNCTION core.validate_notification_recipient()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT core.principal_exists(NEW.recipient_kind, NEW.recipient_id) THEN
    RAISE EXCEPTION 'notification recipient does not exist' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER notifications_validate_recipient BEFORE INSERT OR UPDATE ON core.notifications
FOR EACH ROW EXECUTE FUNCTION core.validate_notification_recipient();
CREATE UNIQUE INDEX notifications_deduplication
  ON core.notifications (recipient_kind, recipient_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;
CREATE INDEX notifications_inbox
  ON core.notifications (recipient_kind, recipient_id, created_at DESC, id)
  WHERE state <> 'archived';
CREATE TRIGGER notifications_bump_version BEFORE UPDATE ON core.notifications
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.notification_deliveries (
  delivery_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  notification_id text NOT NULL REFERENCES core.notifications(id) ON DELETE CASCADE,
  channel_key text NOT NULL CHECK (channel_key ~ '^[a-z][a-z0-9._:-]{1,127}$'),
  destination_reference text NOT NULL CHECK (length(destination_reference) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'delivered', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  provider_receipt text CHECK (provider_receipt IS NULL OR length(provider_receipt) <= 500),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (notification_id, channel_key, destination_reference),
  CONSTRAINT notification_delivery_terminal CHECK (
    (status = 'delivered' AND delivered_at IS NOT NULL AND safe_error_code IS NULL) OR
    (status <> 'delivered' AND delivered_at IS NULL)
  )
);
CREATE INDEX notification_delivery_queue
  ON core.notification_deliveries (next_attempt_at, delivery_id)
  WHERE status IN ('pending', 'failed');
CREATE TRIGGER notification_deliveries_bump_version BEFORE UPDATE ON core.notification_deliveries
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.audit_records (
  global_position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'aud')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_kind text NOT NULL CHECK (actor_kind IN ('user', 'service')),
  actor_id text NOT NULL,
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  resource_kind text NOT NULL CHECK (resource_kind ~ '^[a-z][a-z0-9_-]{1,63}$'),
  resource_id text CHECK (resource_id IS NULL OR core.is_any_canonical_id(resource_id)),
  operation_id text REFERENCES core.operations(id) ON DELETE SET NULL,
  request_id text NOT NULL CHECK (core.is_canonical_id(request_id, 'req')),
  correlation_id text NOT NULL CHECK (core.is_canonical_id(correlation_id, 'cor')),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'denied', 'failed')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  previous_hash bytea NOT NULL CHECK (octet_length(previous_hash) = 32),
  record_hash bytea NOT NULL UNIQUE CHECK (octet_length(record_hash) = 32),
  CONSTRAINT audit_actor CHECK (core.is_principal_id(actor_kind, actor_id)),
  UNIQUE (global_position, record_hash)
);

CREATE OR REPLACE FUNCTION core.compute_audit_hash(
  previous_hash bytea,
  id text,
  occurred_at timestamptz,
  actor_kind text,
  actor_id text,
  action text,
  resource_kind text,
  resource_id text,
  operation_id text,
  request_id text,
  correlation_id text,
  outcome text,
  details jsonb
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT digest(
    encode(previous_hash, 'hex') || '|' || id || '|' ||
    to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') || '|' ||
    actor_kind || '|' || actor_id || '|' || action || '|' || resource_kind || '|' ||
    coalesce(resource_id, '') || '|' || coalesce(operation_id, '') || '|' || request_id || '|' ||
    correlation_id || '|' || outcome || '|' || details::text,
    'sha256'
  );
$$;

CREATE OR REPLACE FUNCTION core.prepare_audit_record()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  head bytea;
BEGIN
  IF NOT core.principal_exists(NEW.actor_kind, NEW.actor_id) THEN
    RAISE EXCEPTION 'audit actor does not exist' USING ERRCODE = '23503';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('core.audit.chain'));
  SELECT record_hash INTO head
    FROM core.audit_records
    ORDER BY global_position DESC
    LIMIT 1;
  NEW.previous_hash := coalesce(head, decode(repeat('00', 32), 'hex'));
  NEW.record_hash := core.compute_audit_hash(
    NEW.previous_hash, NEW.id, NEW.occurred_at, NEW.actor_kind, NEW.actor_id,
    NEW.action, NEW.resource_kind, NEW.resource_id, NEW.operation_id,
    NEW.request_id, NEW.correlation_id, NEW.outcome, NEW.details
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_records_prepare BEFORE INSERT ON core.audit_records
FOR EACH ROW EXECUTE FUNCTION core.prepare_audit_record();
CREATE TRIGGER audit_records_immutable BEFORE UPDATE OR DELETE ON core.audit_records
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE OR REPLACE FUNCTION core.verify_audit_chain()
RETURNS TABLE(global_position bigint, audit_id text, violation text)
LANGUAGE sql
STABLE
AS $$
  WITH chain AS (
    SELECT
      record.global_position,
      record.id,
      record.previous_hash,
      record.record_hash,
      lag(record.record_hash) OVER (ORDER BY record.global_position) AS expected_previous,
      core.compute_audit_hash(
        record.previous_hash, record.id, record.occurred_at, record.actor_kind, record.actor_id,
        record.action, record.resource_kind, record.resource_id, record.operation_id,
        record.request_id, record.correlation_id, record.outcome, record.details
      ) AS expected_hash
    FROM core.audit_records AS record
  )
  SELECT global_position, id,
    CASE
      WHEN previous_hash <> coalesce(expected_previous, decode(repeat('00', 32), 'hex')) THEN 'previous_hash_mismatch'
      WHEN record_hash <> expected_hash THEN 'record_hash_mismatch'
    END
  FROM chain
  WHERE previous_hash <> coalesce(expected_previous, decode(repeat('00', 32), 'hex'))
     OR record_hash <> expected_hash
  ORDER BY global_position;
$$;

CREATE TABLE core.audit_checkpoints (
  audit_global_position bigint PRIMARY KEY,
  record_hash bytea NOT NULL CHECK (octet_length(record_hash) = 32),
  signer_key_reference text NOT NULL CHECK (signer_key_reference ~ '^key://[A-Za-z0-9._/-]+$'),
  signature bytea NOT NULL CHECK (octet_length(signature) >= 64),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (audit_global_position, record_hash)
    REFERENCES core.audit_records(global_position, record_hash) ON DELETE RESTRICT
);
CREATE TRIGGER audit_checkpoints_immutable BEFORE UPDATE OR DELETE ON core.audit_checkpoints
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();
