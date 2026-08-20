-- ALICA Phase 8 /CHAT integration: metadata-only projections and immutable linkage receipts.
-- /CHAT remains owner of product sessions, messages, durable events and realtime delivery.
-- Hermes remains owner of native sessions, executions and native message identifiers.
-- No runtime writer, command route, content replication or production seed is introduced here.

CREATE TABLE core.chat_product_session_projections (
  product_conversation_authority text NOT NULL,
  product_conversation_id text NOT NULL CHECK (core.is_canonical_id(product_conversation_id, 'con')),
  projection_revision bigint NOT NULL CHECK (projection_revision > 0),
  chat_session_native_id text NOT NULL CHECK (length(chat_session_native_id) BETWEEN 1 AND 500),
  principal_id text NOT NULL CHECK (core.is_canonical_id(principal_id, 'prn')),
  tenant_id text NOT NULL CHECK (core.is_canonical_id(tenant_id, 'ten')),
  client_id text NOT NULL CHECK (core.is_canonical_id(client_id, 'cli')),
  application_id text NOT NULL CHECK (core.is_canonical_id(application_id, 'app')),
  product_agent_id text NOT NULL CHECK (core.is_canonical_id(product_agent_id, 'agt')),
  agent_profile_id text NOT NULL REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  authorization_reference text NOT NULL CHECK (length(authorization_reference) BETWEEN 1 AND 500),
  retention_policy_key text NOT NULL CHECK (length(retention_policy_key) BETWEEN 1 AND 200),
  lifecycle_state text NOT NULL CHECK (lifecycle_state IN ('active','archived','deletion-requested','deleted')),
  durable_event_cursor bigint NOT NULL CHECK (durable_event_cursor >= 0),
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 500),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest) = 32),
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (product_conversation_authority, product_conversation_id, projection_revision),
  UNIQUE (product_conversation_authority, chat_session_native_id, projection_revision),
  UNIQUE (
    product_conversation_authority, product_conversation_id, projection_revision,
    principal_id, tenant_id, client_id, application_id, product_agent_id, agent_profile_id
  )
);
CREATE TRIGGER chat_product_session_projections_immutable
BEFORE UPDATE OR DELETE ON core.chat_product_session_projections
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.chat_link_authorization_receipts (
  authorization_receipt_id text PRIMARY KEY CHECK (core.is_canonical_id(authorization_receipt_id, 'evd')),
  product_conversation_authority text NOT NULL,
  product_conversation_id text NOT NULL CHECK (core.is_canonical_id(product_conversation_id, 'con')),
  projection_revision bigint NOT NULL CHECK (projection_revision > 0),
  principal_id text NOT NULL CHECK (core.is_canonical_id(principal_id, 'prn')),
  tenant_id text NOT NULL CHECK (core.is_canonical_id(tenant_id, 'ten')),
  client_id text NOT NULL CHECK (core.is_canonical_id(client_id, 'cli')),
  application_id text NOT NULL CHECK (core.is_canonical_id(application_id, 'app')),
  product_agent_id text NOT NULL CHECK (core.is_canonical_id(product_agent_id, 'agt')),
  agent_profile_id text NOT NULL REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('allowed','denied','held')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  scope_digest bytea NOT NULL CHECK (octet_length(scope_digest) = 32),
  authorization_reference text NOT NULL,
  decided_at timestamptz NOT NULL,
  UNIQUE (
    authorization_receipt_id, product_conversation_authority,
    product_conversation_id, agent_profile_id, decision
  ),
  FOREIGN KEY (
    product_conversation_authority, product_conversation_id, projection_revision,
    principal_id, tenant_id, client_id, application_id, product_agent_id, agent_profile_id
  ) REFERENCES core.chat_product_session_projections(
    product_conversation_authority, product_conversation_id, projection_revision,
    principal_id, tenant_id, client_id, application_id, product_agent_id, agent_profile_id
  ) ON DELETE RESTRICT
);
CREATE TRIGGER chat_link_authorization_receipts_immutable
BEFORE UPDATE OR DELETE ON core.chat_link_authorization_receipts
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.chat_framework_link_receipts (
  link_receipt_id text PRIMARY KEY CHECK (core.is_canonical_id(link_receipt_id, 'evd')),
  authorization_receipt_id text NOT NULL UNIQUE REFERENCES core.chat_link_authorization_receipts(authorization_receipt_id) ON DELETE RESTRICT,
  product_conversation_authority text NOT NULL,
  product_conversation_id text NOT NULL CHECK (core.is_canonical_id(product_conversation_id, 'con')),
  framework_id text NOT NULL REFERENCES core.frameworks(id) ON DELETE RESTRICT,
  agent_profile_id text NOT NULL REFERENCES core.agent_profile_projections(agent_profile_id) ON DELETE RESTRICT,
  framework_session_id text NOT NULL REFERENCES core.framework_session_projections(framework_session_id) ON DELETE RESTRICT,
  agent_execution_id text REFERENCES core.framework_executions(agent_execution_id) ON DELETE RESTRICT,
  authorization_decision text NOT NULL DEFAULT 'allowed' CHECK (authorization_decision = 'allowed'),
  chat_source_version text NOT NULL,
  native_source_version text NOT NULL,
  linkage_state text NOT NULL CHECK (linkage_state IN ('active','unresolved','detached')),
  linked_at timestamptz NOT NULL,
  UNIQUE (product_conversation_authority, product_conversation_id, framework_id, framework_session_id),
  FOREIGN KEY (
    authorization_receipt_id, product_conversation_authority,
    product_conversation_id, agent_profile_id, authorization_decision
  ) REFERENCES core.chat_link_authorization_receipts(
    authorization_receipt_id, product_conversation_authority,
    product_conversation_id, agent_profile_id, decision
  ) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX chat_framework_link_receipts_one_active
ON core.chat_framework_link_receipts(product_conversation_authority, product_conversation_id)
WHERE linkage_state = 'active';
CREATE TRIGGER chat_framework_link_receipts_immutable
BEFORE UPDATE OR DELETE ON core.chat_framework_link_receipts
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.chat_integration_faults (
  fault_id text PRIMARY KEY CHECK (core.is_canonical_id(fault_id, 'evd')),
  product_conversation_authority text NOT NULL,
  product_conversation_id text CHECK (product_conversation_id IS NULL OR core.is_canonical_id(product_conversation_id, 'con')),
  tenant_id text CHECK (tenant_id IS NULL OR core.is_canonical_id(tenant_id, 'ten')),
  client_id text CHECK (client_id IS NULL OR core.is_canonical_id(client_id, 'cli')),
  application_id text CHECK (application_id IS NULL OR core.is_canonical_id(application_id, 'app')),
  agent_profile_id text CHECK (agent_profile_id IS NULL OR core.is_canonical_id(agent_profile_id, 'agp')),
  reason_code text NOT NULL CHECK (reason_code ~ '^P8_[A-Z0-9_]{3,120}$'),
  owner_mutation_count integer NOT NULL DEFAULT 0 CHECK (owner_mutation_count = 0),
  evidence_digest bytea NOT NULL CHECK (octet_length(evidence_digest) = 32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER chat_integration_faults_immutable
BEFORE UPDATE OR DELETE ON core.chat_integration_faults
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.chat_product_session_projections FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.chat_link_authorization_receipts FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.chat_framework_link_receipts FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON core.chat_integration_faults FROM PUBLIC;
