CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  username_normalized text GENERATED ALWAYS AS (lower(username)) STORED,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','locked')),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (username_normalized)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  framework_scope text NOT NULL DEFAULT '',
  resource_scope text NOT NULL DEFAULT '',
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, role_id, framework_scope, resource_scope)
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  device_label text,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_active_user_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  parent_id uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens(family_id);

CREATE TABLE credential_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_kind text NOT NULL CHECK (credential_kind IN ('session','refresh','access')),
  credential_hash text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  reason text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE login_attempts (
  subject_hash text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  blocked_until timestamptz
);

CREATE TABLE framework_registrations (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  adapter_id text NOT NULL,
  base_url text NOT NULL,
  secret_reference text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE resource_mappings (
  canonical_id text PRIMARY KEY,
  kind text NOT NULL,
  owner text NOT NULL,
  framework_id text,
  native_id text NOT NULL,
  source_version text,
  observed_at timestamptz NOT NULL,
  mapping_state text NOT NULL CHECK (mapping_state IN ('current','stale','ambiguous','unavailable')),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE NULLS NOT DISTINCT (owner, framework_id, kind, native_id)
);
CREATE INDEX resource_mappings_framework_idx ON resource_mappings(framework_id, kind);

CREATE TABLE operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  mode text NOT NULL CHECK (mode IN ('validate','dry-run','execute','verify','rollback')),
  idempotency_key text NOT NULL,
  source_version text,
  policy_decision text NOT NULL DEFAULT 'pending' CHECK (policy_decision IN ('pending','allowed','denied')),
  state text NOT NULL DEFAULT 'pending',
  correlation_id text NOT NULL,
  preflight_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_id, operation_type, idempotency_key)
);
CREATE INDEX operations_target_idx ON operations USING gin(target);
CREATE INDEX operations_correlation_idx ON operations(correlation_id);

CREATE TABLE operation_transitions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_id uuid NOT NULL REFERENCES operations(id) ON DELETE RESTRICT,
  from_state text,
  to_state text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operation_transitions_operation_idx ON operation_transitions(operation_id, id);

CREATE TABLE idempotency_records (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_class text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('in_progress','completed','failed')),
  operation_id uuid REFERENCES operations(id) ON DELETE SET NULL,
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (actor_id, operation_class, idempotency_key),
  CHECK (expires_at > created_at)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','failure','inconclusive')),
  request_id text NOT NULL,
  correlation_id text NOT NULL,
  operation_id uuid REFERENCES operations(id) ON DELETE SET NULL,
  framework_id text,
  resource jsonb,
  safe_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_event_hash text,
  event_hash text NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_occurred_idx ON audit_events(occurred_at DESC, id);
CREATE INDEX audit_events_actor_idx ON audit_events(actor_id, occurred_at DESC);

CREATE TABLE evidence_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid REFERENCES operations(id) ON DELETE RESTRICT,
  audit_event_id uuid REFERENCES audit_events(id) ON DELETE RESTRICT,
  evidence_type text NOT NULL,
  storage_uri text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  redaction_version text NOT NULL,
  safe_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (operation_id IS NOT NULL OR audit_event_id IS NOT NULL)
);

CREATE TABLE event_cursors (
  bridge_id text PRIMARY KEY,
  durable_cursor text,
  last_event_at timestamptz,
  last_received_at timestamptz,
  reconnect_count bigint NOT NULL DEFAULT 0,
  replay_state text NOT NULL DEFAULT 'idle',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dedupe_key text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','error','critical')),
  title text NOT NULL,
  body text NOT NULL,
  source jsonb NOT NULL,
  deep_link text,
  state text NOT NULL DEFAULT 'unread' CHECK (state IN ('unread','read','acknowledged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE (recipient_id, dedupe_key)
);

CREATE TABLE application_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  client_type text NOT NULL CHECK (client_type IN ('browser','native','cli','automation')),
  redirect_uris jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_preferences (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES application_registrations(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, application_id)
);

CREATE TABLE derived_cache (
  cache_key text PRIMARY KEY,
  owner text NOT NULL,
  framework_id text,
  source_status text NOT NULL,
  value jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  stored_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at >= observed_at)
);

INSERT INTO permissions(name, description) VALUES
 ('frameworks.read','Read framework inventory'), ('profiles.read','Read profiles'),
 ('profiles.manage','Manage profiles'), ('profiles.delete','Delete disposable profiles'),
 ('models.read','Read models and providers'), ('models.manage','Manage model routing'),
 ('credentials.manage','Manage credential vault records'), ('work.read','Read work resources'),
 ('work.manage','Manage work resources'), ('work.autonomy','Approve autonomy changes'),
 ('chat.read','Read permitted chat sessions'), ('chat.use','Send to permitted sessions'),
 ('chat.admin','Administer chat routes'), ('memory.read','Read permitted memory'),
 ('memory.write','Write permitted memory'), ('memory.promote','Promote governed memory'),
 ('memory.admin','Administer memory'), ('audit.read','Read audit'),
 ('users.manage','Manage users and sessions'), ('settings.manage','Manage gateway settings'),
 ('operations.read','Read operation evidence')
ON CONFLICT (name) DO NOTHING;

INSERT INTO roles(name, description, system) VALUES
 ('Viewer','Read-only operator access',true), ('Operator','Routine operational access',true),
 ('Administrator','Administrative access',true), ('Auditor/Security','Audit and security review',true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.name = 'Viewer' AND p.name IN ('frameworks.read','profiles.read','models.read','work.read','chat.read','memory.read'))
   OR (r.name = 'Operator' AND p.name IN ('frameworks.read','profiles.read','profiles.manage','models.read','models.manage','work.read','work.manage','chat.read','chat.use','memory.read','memory.write','operations.read'))
   OR (r.name = 'Administrator')
   OR (r.name = 'Auditor/Security' AND p.name IN ('frameworks.read','profiles.read','models.read','work.read','chat.read','memory.read','audit.read','operations.read'))
ON CONFLICT DO NOTHING;
