DO $$
DECLARE populated boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM core.alica_installation_identity UNION ALL
    SELECT 1 FROM core.alica_principal_aliases UNION ALL
    SELECT 1 FROM core.alica_external_identity_bindings UNION ALL
    SELECT 1 FROM core.alica_membership_role_bindings UNION ALL
    SELECT 1 FROM core.alica_tenant_client_grants UNION ALL
    SELECT 1 FROM core.alica_principal_client_grants UNION ALL
    SELECT 1 FROM core.alica_principal_instance_grants UNION ALL
    SELECT 1 FROM core.alica_managed_projection_state UNION ALL
    SELECT 1 FROM core.alica_managed_trust_anchors UNION ALL
    SELECT 1 FROM core.alica_identity_phase_evidence UNION ALL
    SELECT 1 FROM core.alica_identity_canary_policies UNION ALL
    SELECT 1 FROM core.alica_cell_instances UNION ALL
    SELECT 1 FROM core.alica_registered_clients UNION ALL
    SELECT 1 FROM core.alica_tenant_memberships UNION ALL
    SELECT 1 FROM core.alica_principals UNION ALL
    SELECT 1 FROM core.alica_tenants
  ) INTO populated;
  IF populated THEN
    RAISE EXCEPTION 'ALICA_IDENTITY_FORWARD_REPAIR_REQUIRED' USING ERRCODE='55000';
  END IF;
END $$;

DROP TABLE core.alica_identity_phase_evidence;
DROP TABLE core.alica_identity_canary_policies;
DROP TABLE core.alica_managed_projection_state;
DROP TABLE core.alica_managed_trust_anchors;
DROP FUNCTION core.evaluate_alica_instance_authorization(text,text,text,text,text,boolean,boolean);
DROP TABLE core.alica_principal_instance_grants;
DROP TABLE core.alica_cell_instances;
DROP TABLE core.alica_principal_client_grants;
DROP TABLE core.alica_tenant_client_grants;
DROP TABLE core.alica_registered_clients;
DROP TABLE core.alica_membership_role_bindings;
DROP TABLE core.alica_tenant_memberships;
DROP TABLE core.alica_external_identity_bindings;
DROP TRIGGER alica_principal_alias_guard ON core.alica_principal_aliases;
DROP TABLE core.alica_principal_aliases;
DROP FUNCTION core.guard_alica_principal_alias();
DROP TABLE core.alica_principals;
DROP TABLE core.alica_installation_identity;
DROP TABLE core.alica_tenants;
