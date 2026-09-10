-- Core owns admission/delivery, never native task state or application conversations.
CREATE TABLE application_integrations (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 manifest jsonb NOT NULL, native_binding jsonb NOT NULL DEFAULT '{}'::jsonb, callback_secret_ciphertext text,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE application_credentials (
 id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES application_integrations(id),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE application_receipts (
 id uuid PRIMARY KEY, application_id uuid NOT NULL REFERENCES application_integrations(id),
 idempotency_key text NOT NULL, payload_hash text NOT NULL, payload jsonb,
 phase text NOT NULL CHECK(phase IN ('accepted','dispatch-unknown','native-linked','cancel-requested','cancelled','result-ready','rejected','deletion-pending','deleted')),
 native_reference jsonb, result jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 UNIQUE(application_id,idempotency_key)
);
CREATE TABLE application_outbox (
 id uuid PRIMARY KEY, receipt_id uuid NOT NULL UNIQUE REFERENCES application_receipts(id),
 application_id uuid NOT NULL REFERENCES application_integrations(id),
 state text NOT NULL CHECK(state IN ('pending','delivering','delivered','exhausted','cancelled')),
 attempt integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid, lease_until timestamptz, last_error text,
 delivered_at timestamptz
);
CREATE INDEX application_receipts_dispatch ON application_receipts(phase,created_at);
CREATE INDEX application_outbox_dispatch ON application_outbox(state,next_attempt_at);

REVOKE ALL ON application_integrations,application_credentials,application_receipts,application_outbox FROM PUBLIC,unify_hermes_adapter_runtime;
