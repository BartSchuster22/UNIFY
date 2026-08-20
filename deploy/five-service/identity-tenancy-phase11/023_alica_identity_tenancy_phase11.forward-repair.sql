-- Forward-only repair for non-data structural edges. Never rewrites canonical rows.
DO $$
BEGIN
  IF to_regclass('core.alica_tenants') IS NULL
     OR to_regclass('core.alica_principals') IS NULL
     OR to_regclass('core.alica_cell_instances') IS NULL
     OR to_regclass('core.alica_identity_phase_evidence') IS NULL THEN
    RAISE EXCEPTION 'ALICA_IDENTITY_BASE_TABLE_MISSING_RESTORE_REQUIRED' USING ERRCODE='55000';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS alica_principal_alias_identity_unique
  ON core.alica_principal_aliases(alias_namespace,alias_value,principal_id);
CREATE INDEX IF NOT EXISTS alica_memberships_principal_status_idx
  ON core.alica_tenant_memberships(principal_id,status,tenant_id);
CREATE INDEX IF NOT EXISTS alica_instance_grants_scope_idx
  ON core.alica_principal_instance_grants(instance_id,membership_id,client_id,status);
CREATE INDEX IF NOT EXISTS alica_managed_projection_freshness_idx
  ON core.alica_managed_projection_state(status,fresh_until);

DROP TRIGGER IF EXISTS alica_principal_alias_guard ON core.alica_principal_aliases;
CREATE TRIGGER alica_principal_alias_guard
BEFORE UPDATE OR DELETE ON core.alica_principal_aliases
FOR EACH ROW EXECUTE FUNCTION core.guard_alica_principal_alias();
