-- Explicit operator rollback only. Export admission/delivery records first.
DROP TABLE application_outbox;
DROP TABLE application_receipts;
DROP TABLE application_credentials;
DROP TABLE application_integrations;
