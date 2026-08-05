CREATE TABLE core.conversation_channels (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'chn')),
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('telegram','whatsapp','custom')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','inactive','archived')),
  secret_reference text NOT NULL CHECK (secret_reference ~ '^secret://[A-Za-z0-9/_.:-]+$'),
  external_identity text CHECK (external_identity IS NULL OR length(external_identity) <= 500),
  session_policy text NOT NULL CHECK (session_policy IN ('per-external-conversation','single-channel-conversation')),
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER conversation_channels_bump_version BEFORE UPDATE ON core.conversation_channels
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.conversations (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'cvs')),
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  ownership text NOT NULL DEFAULT 'core' CHECK (ownership IN ('core','external')),
  owner_kind text NOT NULL CHECK (owner_kind IN ('user','service')),
  owner_id text NOT NULL,
  channel_id text REFERENCES core.conversation_channels(id) ON DELETE RESTRICT,
  external_conversation_reference text CHECK (external_conversation_reference IS NULL OR length(external_conversation_reference) BETWEEN 1 AND 1000),
  last_sequence bigint NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conversation_owner CHECK (core.is_principal_id(owner_kind, owner_id)),
  CONSTRAINT conversation_external_shape CHECK (
    (ownership='core' AND channel_id IS NULL AND external_conversation_reference IS NULL) OR
    (ownership='external' AND channel_id IS NOT NULL AND external_conversation_reference IS NOT NULL)
  )
);
CREATE UNIQUE INDEX conversations_external_identity
  ON core.conversations(channel_id, external_conversation_reference)
  WHERE ownership='external';
CREATE INDEX conversations_owner_history ON core.conversations(owner_kind,owner_id,state,updated_at DESC,id);
CREATE TRIGGER conversations_bump_version BEFORE UPDATE ON core.conversations
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();
CREATE OR REPLACE FUNCTION core.validate_conversation_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT core.principal_exists(NEW.owner_kind,NEW.owner_id) THEN
    RAISE EXCEPTION 'conversation owner does not exist' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversations_validate_owner BEFORE INSERT OR UPDATE ON core.conversations
FOR EACH ROW EXECUTE FUNCTION core.validate_conversation_owner();

CREATE TABLE core.conversation_attachments (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'att')),
  owner_kind text NOT NULL CHECK (owner_kind IN ('user','service')),
  owner_id text NOT NULL,
  filename text NOT NULL CHECK (filename ~ '^[A-Za-z0-9][A-Za-z0-9._ -]{0,254}$' AND position('..' in filename)=0),
  media_type text NOT NULL CHECK (media_type ~ '^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$'),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 52428800),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  content bytea NOT NULL,
  state text NOT NULL DEFAULT 'available' CHECK (state IN ('pending','available','rejected')),
  rejection_code text CHECK (rejection_code IS NULL OR rejection_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conversation_attachment_owner CHECK (core.is_principal_id(owner_kind, owner_id)),
  CONSTRAINT conversation_attachment_size CHECK (octet_length(content)=size_bytes),
  CONSTRAINT conversation_attachment_state CHECK ((state='rejected')=(rejection_code IS NOT NULL))
);
CREATE INDEX conversation_attachments_owner ON core.conversation_attachments(owner_kind,owner_id,created_at DESC);
CREATE TRIGGER conversation_attachments_bump_version BEFORE UPDATE ON core.conversation_attachments
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();
CREATE TRIGGER conversation_attachments_validate_owner BEFORE INSERT OR UPDATE ON core.conversation_attachments
FOR EACH ROW EXECUTE FUNCTION core.validate_conversation_owner();

CREATE OR REPLACE FUNCTION core.valid_conversation_blocks(value jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value)='array'
    AND jsonb_array_length(value) BETWEEN 1 AND 100
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) block
      WHERE jsonb_typeof(block)<>'object'
        OR NOT (
          (block->>'kind'='text' AND jsonb_typeof(block->'text')='string'
            AND length(block->>'text') BETWEEN 1 AND 100000)
          OR
          (block->>'kind'='attachment' AND core.is_canonical_id(block->>'attachmentId','att')
            AND (NOT block ? 'caption' OR (jsonb_typeof(block->'caption')='string'
              AND length(block->>'caption') <= 5000)))
        )
    )
$$;

CREATE TABLE core.conversation_messages (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'msg')),
  conversation_id text NOT NULL REFERENCES core.conversations(id) ON DELETE RESTRICT,
  sender_kind text NOT NULL CHECK (sender_kind IN ('user','service','profile','system')),
  sender_id text,
  sequence bigint NOT NULL CHECK (sequence > 0),
  state text NOT NULL CHECK (state IN ('accepted','streaming','complete','failed')),
  blocks jsonb NOT NULL CHECK (core.valid_conversation_blocks(blocks)),
  client_message_id text CHECK (client_message_id IS NULL OR client_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  failure_code text CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conversation_message_sender CHECK (
    (sender_kind='user' AND core.is_canonical_id(sender_id,'usr')) OR
    (sender_kind='service' AND core.is_canonical_id(sender_id,'svc')) OR
    (sender_kind='profile' AND core.is_canonical_id(sender_id,'prf')) OR
    (sender_kind='system' AND sender_id IS NULL)
  ),
  CONSTRAINT conversation_message_failure CHECK ((state='failed')=(failure_code IS NOT NULL)),
  UNIQUE(conversation_id,sequence)
);
CREATE UNIQUE INDEX conversation_messages_duplicate_send
  ON core.conversation_messages(conversation_id,client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE INDEX conversation_messages_history ON core.conversation_messages(conversation_id,sequence DESC);
CREATE TRIGGER conversation_messages_bump_version BEFORE UPDATE ON core.conversation_messages
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();
CREATE OR REPLACE FUNCTION core.validate_conversation_message() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE conversation_profile text; conversation_sequence bigint;
BEGIN
  SELECT profile_id,last_sequence INTO conversation_profile,conversation_sequence
  FROM core.conversations WHERE id=NEW.conversation_id;
  IF NEW.sequence > conversation_sequence THEN
    RAISE EXCEPTION 'message sequence was not allocated by conversation' USING ERRCODE='23514';
  END IF;
  IF NEW.sender_kind='profile' AND NEW.sender_id<>conversation_profile THEN
    RAISE EXCEPTION 'message profile does not own conversation route' USING ERRCODE='23514';
  END IF;
  IF NEW.sender_kind IN ('user','service') AND NOT core.principal_exists(NEW.sender_kind,NEW.sender_id) THEN
    RAISE EXCEPTION 'message sender does not exist' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_messages_validate BEFORE INSERT OR UPDATE ON core.conversation_messages
FOR EACH ROW EXECUTE FUNCTION core.validate_conversation_message();

CREATE TABLE core.conversation_message_attachments (
  message_id text NOT NULL REFERENCES core.conversation_messages(id) ON DELETE RESTRICT,
  attachment_id text NOT NULL UNIQUE REFERENCES core.conversation_attachments(id) ON DELETE RESTRICT,
  PRIMARY KEY(message_id,attachment_id)
);
CREATE OR REPLACE FUNCTION core.validate_conversation_attachment_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE conversation_owner_kind text; conversation_owner_id text; attachment_owner_kind text; attachment_owner_id text; attachment_state text;
BEGIN
  SELECT c.owner_kind,c.owner_id INTO conversation_owner_kind,conversation_owner_id
  FROM core.conversation_messages m JOIN core.conversations c ON c.id=m.conversation_id WHERE m.id=NEW.message_id;
  SELECT owner_kind,owner_id,state INTO attachment_owner_kind,attachment_owner_id,attachment_state
  FROM core.conversation_attachments WHERE id=NEW.attachment_id;
  IF attachment_state <> 'available' OR conversation_owner_kind <> attachment_owner_kind OR conversation_owner_id <> attachment_owner_id THEN
    RAISE EXCEPTION 'attachment is unavailable or owned by another principal' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_message_attachments_validate BEFORE INSERT ON core.conversation_message_attachments
FOR EACH ROW EXECUTE FUNCTION core.validate_conversation_attachment_link();
CREATE OR REPLACE FUNCTION core.validate_conversation_message_attachment_shape() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE block_count integer; link_count integer;
BEGIN
  SELECT count(*) INTO block_count FROM jsonb_array_elements(NEW.blocks) block WHERE block->>'kind'='attachment';
  SELECT count(*) INTO link_count FROM core.conversation_message_attachments WHERE message_id=NEW.id;
  IF block_count<>link_count OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.blocks) block
    WHERE block->>'kind'='attachment' AND NOT EXISTS (
      SELECT 1 FROM core.conversation_message_attachments link
      WHERE link.message_id=NEW.id AND link.attachment_id=block->>'attachmentId'
    )
  ) THEN
    RAISE EXCEPTION 'message attachment links do not match blocks' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER conversation_messages_validate_attachment_shape
AFTER INSERT OR UPDATE ON core.conversation_messages DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION core.validate_conversation_message_attachment_shape();

CREATE TABLE core.conversation_dispatches (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'run')),
  conversation_id text NOT NULL REFERENCES core.conversations(id) ON DELETE RESTRICT,
  request_message_id text NOT NULL UNIQUE REFERENCES core.conversation_messages(id) ON DELETE RESTRICT,
  response_message_id text UNIQUE REFERENCES core.conversation_messages(id) ON DELETE RESTRICT,
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','dispatching','succeeded','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  safe_error_code text CHECK (safe_error_code IS NULL OR safe_error_code ~ '^[a-z][a-z0-9_]{2,127}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT conversation_dispatch_lease CHECK (
    (state='dispatching' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL) OR
    (state<>'dispatching' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT conversation_dispatch_result CHECK (
    (state='succeeded' AND response_message_id IS NOT NULL AND safe_error_code IS NULL) OR
    (state='failed' AND response_message_id IS NULL AND safe_error_code IS NOT NULL) OR
    (state IN ('pending','dispatching') AND response_message_id IS NULL AND safe_error_code IS NULL)
  )
);
CREATE INDEX conversation_dispatch_queue ON core.conversation_dispatches(state,created_at,id)
WHERE state IN ('pending','dispatching');

CREATE TABLE core.conversation_event_cursors (
  principal_kind text NOT NULL CHECK (principal_kind IN ('user','service')),
  principal_id text NOT NULL,
  cursor_key text NOT NULL CHECK (cursor_key ~ '^[a-z][a-z0-9._:-]{2,127}$'),
  global_position bigint NOT NULL DEFAULT 0 CHECK (global_position >= 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(principal_kind,principal_id,cursor_key),
  CONSTRAINT conversation_cursor_owner CHECK (core.is_principal_id(principal_kind,principal_id))
);
CREATE OR REPLACE FUNCTION core.protect_conversation_cursor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE event_head bigint;
BEGIN
  IF NOT core.principal_exists(NEW.principal_kind,NEW.principal_id) THEN
    RAISE EXCEPTION 'conversation cursor owner does not exist' USING ERRCODE='23503';
  END IF;
  SELECT coalesce(max(global_position),0) INTO event_head FROM core.events;
  IF TG_OP='UPDATE' AND NEW.global_position < OLD.global_position THEN
    RAISE EXCEPTION 'conversation cursor regression' USING ERRCODE='40001';
  END IF;
  IF NEW.global_position > event_head THEN
    RAISE EXCEPTION 'conversation cursor exceeds event head' USING ERRCODE='22023';
  END IF;
  IF TG_OP='UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversation_event_cursors_protect BEFORE INSERT OR UPDATE ON core.conversation_event_cursors
FOR EACH ROW EXECUTE FUNCTION core.protect_conversation_cursor();

INSERT INTO core.authorization_permissions(permission_key,description) VALUES
 ('chat.read','Read authorized native conversation agents, sessions, messages, attachments, and events.'),
 ('chat.use','Create native conversations, upload attachments, and send messages.'),
 ('chat.manage','Manage external conversations and channels and inspect all native conversations.')
ON CONFLICT DO NOTHING;
INSERT INTO core.authorization_role_permissions(role_key,permission_key) VALUES
 ('core.admin','chat.read'),('core.admin','chat.use'),('core.admin','chat.manage'),
 ('core.operator','chat.read'),('core.operator','chat.use'),
 ('core.viewer','chat.read')
ON CONFLICT DO NOTHING;
