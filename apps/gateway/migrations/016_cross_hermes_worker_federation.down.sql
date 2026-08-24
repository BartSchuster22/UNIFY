REVOKE USAGE, SELECT ON SEQUENCE federation_worker_lease_events_id_seq FROM gateway_runtime;
REVOKE SELECT, INSERT ON federation_worker_lease_events FROM gateway_runtime;
REVOKE SELECT, INSERT, UPDATE ON federation_worker_leases FROM gateway_runtime;
DROP TRIGGER IF EXISTS federation_worker_lease_event_immutable ON federation_worker_lease_events;
DROP FUNCTION IF EXISTS prevent_federation_event_mutation();
DROP TRIGGER IF EXISTS federation_worker_lease_identity_immutable ON federation_worker_leases;
DROP FUNCTION IF EXISTS prevent_federation_identity_mutation();
DROP TABLE IF EXISTS federation_worker_lease_events;
DROP TABLE IF EXISTS federation_worker_leases;
