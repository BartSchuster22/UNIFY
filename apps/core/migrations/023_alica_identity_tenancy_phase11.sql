-- ALICA Identity and Tenancy Phase 11: additive canonical identity, tenant,
-- registered-client, managed-projection and exact Cell-instance authorization state.
-- Predecessor authentication/RBAC remains intact. No runtime reader or credential is added.

CREATE TABLE core.alica_tenants (
  tenant_id text PRIMARY KEY CHECK (core.is_canonical_id(tenant_id, 'ten')),
  origin text NOT NULL CHECK (origin IN ('dsh-local','managed-uprm')),
  slug_normalized text NOT NULL UNIQUE CHECK (slug_normalized ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('provisioning','active','suspended','closing','closed')),
  authority text NOT NULL CHECK (authority IN ('cell','uprm')),
  source_version bigint CHECK (source_version IS NULL OR source_version > 0),
  accepted_at timestamptz,
  fresh_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  CHECK ((origin='dsh-local' AND authority='cell' AND source_version IS NULL)
      OR (origin='managed-uprm' AND authority='uprm' AND source_version IS NOT NULL AND accepted_at IS NOT NULL))
);

CREATE TABLE core.alica_installation_identity (
  singleton_key text PRIMARY KEY CHECK (singleton_key='cell'),
  home_tenant_id text NOT NULL UNIQUE REFERENCES core.alica_tenants(tenant_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE TRIGGER alica_installation_identity_immutable
BEFORE UPDATE OR DELETE ON core.alica_installation_identity
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.alica_principals (
  principal_id text PRIMARY KEY CHECK (core.is_canonical_id(principal_id, 'prn')),
  kind text NOT NULL CHECK (kind IN ('user','service')),
  status text NOT NULL CHECK (status IN ('active','suspended','retired')),
  authority text NOT NULL CHECK (authority IN ('cell','identity-authority','uprm')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE core.alica_principal_aliases (
  alias_namespace text NOT NULL CHECK (alias_namespace IN ('gateway-user-uuid','legacy-usr-id','legacy-svc-id','psi-user-uuid')),
  alias_value text NOT NULL CHECK (length(alias_value) BETWEEN 1 AND 200),
  principal_id text NOT NULL REFERENCES core.alica_principals(principal_id) ON DELETE RESTRICT,
  source_table text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retired_at timestamptz,
  PRIMARY KEY (alias_namespace,alias_value)
);
CREATE OR REPLACE FUNCTION core.guard_alica_principal_alias()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'ALICA principal aliases are retained' USING ERRCODE='55000'; END IF;
  IF NEW.alias_namespace<>OLD.alias_namespace OR NEW.alias_value<>OLD.alias_value OR NEW.principal_id<>OLD.principal_id THEN
    RAISE EXCEPTION 'ALICA principal aliases cannot be reassigned' USING ERRCODE='55000';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'ALICA principal alias retirement is monotonic' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER alica_principal_alias_guard
BEFORE UPDATE OR DELETE ON core.alica_principal_aliases
FOR EACH ROW EXECUTE FUNCTION core.guard_alica_principal_alias();

CREATE TABLE core.alica_external_identity_bindings (
  binding_id text PRIMARY KEY CHECK (core.is_canonical_id(binding_id, 'idb')),
  principal_id text NOT NULL REFERENCES core.alica_principals(principal_id) ON DELETE RESTRICT,
  issuer_normalized text NOT NULL CHECK (issuer_normalized=lower(trim(issuer_normalized)) AND length(issuer_normalized) BETWEEN 3 AND 500),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 500),
  status text NOT NULL CHECK (status IN ('active','revoked')),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (issuer_normalized,subject),
  CHECK ((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL))
);

CREATE TABLE core.alica_tenant_memberships (
  membership_id text PRIMARY KEY CHECK (core.is_canonical_id(membership_id, 'mbr')),
  tenant_id text NOT NULL REFERENCES core.alica_tenants(tenant_id) ON DELETE RESTRICT,
  principal_id text NOT NULL REFERENCES core.alica_principals(principal_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('invited','active','suspended','revoked','left')),
  authority text NOT NULL CHECK (authority IN ('cell','uprm')),
  source_version bigint CHECK (source_version IS NULL OR source_version > 0),
  accepted_at timestamptz,
  fresh_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (tenant_id,principal_id),
  CHECK ((authority='cell' AND source_version IS NULL) OR (authority='uprm' AND source_version IS NOT NULL AND accepted_at IS NOT NULL AND fresh_until IS NOT NULL))
);

CREATE TABLE core.alica_membership_role_bindings (
  membership_id text NOT NULL REFERENCES core.alica_tenant_memberships(membership_id) ON DELETE RESTRICT,
  legacy_role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
  framework_scope text NOT NULL DEFAULT '',
  resource_scope text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (membership_id,legacy_role_id,framework_scope,resource_scope)
);

CREATE TABLE core.alica_registered_clients (
  client_id text PRIMARY KEY CHECK (core.is_canonical_id(client_id, 'cli')),
  client_key text NOT NULL UNIQUE CHECK (client_key ~ '^[a-z0-9][a-z0-9._-]{1,126}$'),
  display_name text NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 200),
  client_type text NOT NULL CHECK (client_type IN ('browser-bff','native','service','agent')),
  identity_profile text NOT NULL CHECK (identity_profile IN ('dsh-standard/v1','dsh-minimal/v1','managed-psi/v1')),
  status text NOT NULL CHECK (status IN ('active','disabled','retired')),
  legacy_application_id uuid UNIQUE REFERENCES public.application_registrations(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE core.alica_tenant_client_grants (
  grant_id text PRIMARY KEY CHECK (core.is_canonical_id(grant_id, 'grn')),
  tenant_id text NOT NULL REFERENCES core.alica_tenants(tenant_id) ON DELETE RESTRICT,
  client_id text NOT NULL REFERENCES core.alica_registered_clients(client_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
  capability_ceiling jsonb NOT NULL CHECK (jsonb_typeof(capability_ceiling)='array'),
  authority text NOT NULL CHECK (authority IN ('cell','uprm')),
  source_version bigint CHECK (source_version IS NULL OR source_version > 0),
  accepted_at timestamptz,
  fresh_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (tenant_id,client_id),
  CHECK ((authority='cell' AND source_version IS NULL) OR (authority='uprm' AND source_version IS NOT NULL AND accepted_at IS NOT NULL AND fresh_until IS NOT NULL))
);

CREATE TABLE core.alica_principal_client_grants (
  grant_id text PRIMARY KEY CHECK (core.is_canonical_id(grant_id, 'grn')),
  membership_id text NOT NULL REFERENCES core.alica_tenant_memberships(membership_id) ON DELETE RESTRICT,
  client_id text NOT NULL REFERENCES core.alica_registered_clients(client_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
  capability_ceiling jsonb NOT NULL CHECK (jsonb_typeof(capability_ceiling)='array'),
  authority text NOT NULL CHECK (authority IN ('cell','uprm')),
  source_version bigint CHECK (source_version IS NULL OR source_version > 0),
  accepted_at timestamptz,
  fresh_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (membership_id,client_id),
  CHECK ((authority='cell' AND source_version IS NULL) OR (authority='uprm' AND source_version IS NOT NULL AND accepted_at IS NOT NULL AND fresh_until IS NOT NULL))
);

CREATE TABLE core.alica_cell_instances (
  instance_id text PRIMARY KEY CHECK (core.is_canonical_id(instance_id, 'ins')),
  tenant_id text NOT NULL REFERENCES core.alica_tenants(tenant_id) ON DELETE RESTRICT,
  identity_profile text NOT NULL CHECK (identity_profile IN ('dsh-standard/v1','dsh-minimal/v1','managed-psi/v1')),
  native_namespace text NOT NULL CHECK (native_namespace IN ('dsh-cell','psi-vps-uuid','psi-container-uuid')),
  native_value text NOT NULL CHECK (length(native_value) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('provisioning','active','suspended','replacing','retired')),
  authority text NOT NULL CHECK (authority IN ('cell','psi')),
  source_version bigint CHECK (source_version IS NULL OR source_version > 0),
  accepted_at timestamptz,
  fresh_until timestamptz,
  replacement_for_instance_id text REFERENCES core.alica_cell_instances(instance_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (native_namespace,native_value),
  CHECK (replacement_for_instance_id IS NULL OR replacement_for_instance_id<>instance_id),
  CHECK ((authority='cell' AND source_version IS NULL) OR (authority='psi' AND source_version IS NOT NULL AND accepted_at IS NOT NULL AND fresh_until IS NOT NULL))
);

CREATE TABLE core.alica_principal_instance_grants (
  grant_id text PRIMARY KEY CHECK (core.is_canonical_id(grant_id, 'grn')),
  membership_id text NOT NULL REFERENCES core.alica_tenant_memberships(membership_id) ON DELETE RESTRICT,
  client_id text NOT NULL REFERENCES core.alica_registered_clients(client_id) ON DELETE RESTRICT,
  instance_id text NOT NULL REFERENCES core.alica_cell_instances(instance_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('active','suspended','revoked')),
  capability_ceiling jsonb NOT NULL CHECK (jsonb_typeof(capability_ceiling)='array'),
  authority text NOT NULL CHECK (authority IN ('cell','psi')),
  source_version bigint CHECK (source_version IS NULL OR source_version > 0),
  accepted_at timestamptz,
  fresh_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  UNIQUE (membership_id,client_id,instance_id),
  CHECK ((authority='cell' AND source_version IS NULL) OR (authority='psi' AND source_version IS NOT NULL AND accepted_at IS NOT NULL AND fresh_until IS NOT NULL))
);

CREATE OR REPLACE FUNCTION core.evaluate_alica_instance_authorization(
  requested_principal_id text,
  requested_client_id text,
  requested_tenant_id text,
  requested_instance_id text,
  requested_capability text,
  technical_permission boolean,
  entitlement_allows boolean DEFAULT true
) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE allowed boolean;
BEGIN
  IF NOT technical_permission THEN RETURN 'TECHNICAL_PERMISSION_REQUIRED'; END IF;
  IF NOT entitlement_allows THEN RETURN 'ENTITLEMENT_DENIED'; END IF;
  SELECT EXISTS (
    SELECT 1
    FROM core.alica_principals p
    JOIN core.alica_tenant_memberships m ON m.principal_id=p.principal_id
    JOIN core.alica_tenants t ON t.tenant_id=m.tenant_id
    JOIN core.alica_registered_clients c ON c.client_id=requested_client_id
    JOIN core.alica_tenant_client_grants tg ON tg.tenant_id=m.tenant_id AND tg.client_id=c.client_id
    JOIN core.alica_principal_client_grants pg ON pg.membership_id=m.membership_id AND pg.client_id=c.client_id
    JOIN core.alica_cell_instances i ON i.tenant_id=m.tenant_id AND i.instance_id=requested_instance_id
    JOIN core.alica_principal_instance_grants ig ON ig.membership_id=m.membership_id AND ig.client_id=c.client_id AND ig.instance_id=i.instance_id
    WHERE p.principal_id=requested_principal_id
      AND m.tenant_id=requested_tenant_id
      AND p.status='active' AND t.status='active' AND m.status='active' AND c.status='active'
      AND tg.status='active' AND pg.status='active' AND i.status='active' AND ig.status='active'
      AND (m.authority='cell' OR m.fresh_until>clock_timestamp())
      AND (i.authority='cell' OR i.fresh_until>clock_timestamp())
      AND tg.capability_ceiling ? requested_capability
      AND pg.capability_ceiling ? requested_capability
      AND ig.capability_ceiling ? requested_capability
  ) INTO allowed;
  RETURN CASE WHEN allowed THEN 'AUTHORIZED' ELSE 'AUTHORIZATION_DENIED' END;
END $$;

CREATE TABLE core.alica_managed_trust_anchors (
  authority text NOT NULL CHECK (authority IN ('uprm','psi')),
  issuer_normalized text NOT NULL CHECK (issuer_normalized=lower(trim(issuer_normalized))),
  audience_cell text NOT NULL CHECK (length(audience_cell) BETWEEN 1 AND 200),
  signer_fingerprint bytea NOT NULL CHECK (octet_length(signer_fingerprint)=32),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
  valid_from timestamptz NOT NULL,
  valid_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (authority,issuer_normalized,audience_cell,signer_fingerprint),
  CHECK ((status='revoked' AND revoked_at IS NOT NULL) OR status<>'revoked'),
  CHECK (valid_until IS NULL OR valid_until>valid_from)
);

CREATE TABLE core.alica_managed_projection_state (
  authority text NOT NULL CHECK (authority IN ('uprm','psi')),
  projection_kind text NOT NULL CHECK (projection_kind IN ('tenant','membership','client-grant','instance','instance-grant')),
  tenant_id text NOT NULL REFERENCES core.alica_tenants(tenant_id) ON DELETE RESTRICT,
  source_version bigint NOT NULL CHECK (source_version > 0),
  message_id text NOT NULL UNIQUE CHECK (length(message_id) BETWEEN 8 AND 200),
  issuer_normalized text NOT NULL CHECK (issuer_normalized=lower(trim(issuer_normalized))),
  audience_cell text NOT NULL CHECK (length(audience_cell) BETWEEN 1 AND 200),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
  signer_fingerprint bytea NOT NULL CHECK (octet_length(signer_fingerprint)=32),
  accepted_at timestamptz NOT NULL,
  fresh_until timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('accepted','stale','revoked','rejected')),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (authority,projection_kind,tenant_id),
  FOREIGN KEY (authority,issuer_normalized,audience_cell,signer_fingerprint)
    REFERENCES core.alica_managed_trust_anchors(authority,issuer_normalized,audience_cell,signer_fingerprint) ON DELETE RESTRICT,
  CHECK (fresh_until>accepted_at)
);

CREATE TABLE core.alica_identity_canary_policies (
  policy_id text PRIMARY KEY CHECK (core.is_canonical_id(policy_id, 'pol')),
  contract_version text NOT NULL CHECK (contract_version='alica-identity-tenancy-execution/v0.1'),
  allowed_profiles text[] NOT NULL CHECK (allowed_profiles <@ ARRAY['dsh-standard/v1','dsh-minimal/v1','managed-psi/v1']::text[]),
  approval_reference text NOT NULL CHECK (length(approval_reference) BETWEEN 1 AND 500),
  enabled boolean NOT NULL DEFAULT false CHECK (NOT enabled),
  terminal_state text NOT NULL DEFAULT 'disabled' CHECK (terminal_state='disabled'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER alica_identity_canary_policies_immutable
BEFORE UPDATE OR DELETE ON core.alica_identity_canary_policies
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.alica_identity_phase_evidence (
  evidence_id text PRIMARY KEY CHECK (core.is_canonical_id(evidence_id, 'evd')),
  policy_id text NOT NULL REFERENCES core.alica_identity_canary_policies(policy_id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('I2','I3','I4','I5','I6','I7')),
  evidence_kind text NOT NULL CHECK (evidence_kind IN ('schema-rehearsal','live-backfill','dsh-shadow','psi-shadow','enforcement-canary','recovery-retirement')),
  result text NOT NULL CHECK (result IN ('passed','held')),
  execution_scope text NOT NULL CHECK (execution_scope IN ('isolated-database','live-additive','pure-evaluator','isolated-credential')),
  source_digest bytea NOT NULL CHECK (octet_length(source_digest)=32),
  result_digest bytea NOT NULL CHECK (octet_length(result_digest)=32),
  mutation_count integer NOT NULL CHECK (mutation_count>=0),
  owner_state_preserved boolean NOT NULL CHECK (owner_state_preserved),
  secret_material_persisted boolean NOT NULL CHECK (NOT secret_material_persisted),
  safe_result_code text NOT NULL CHECK (safe_result_code ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) BETWEEN 1 AND 1000),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (policy_id,phase)
);
CREATE TRIGGER alica_identity_phase_evidence_immutable
BEFORE UPDATE OR DELETE ON core.alica_identity_phase_evidence
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

REVOKE INSERT,UPDATE,DELETE ON core.alica_identity_canary_policies FROM PUBLIC;
REVOKE INSERT,UPDATE,DELETE ON core.alica_identity_phase_evidence FROM PUBLIC;
