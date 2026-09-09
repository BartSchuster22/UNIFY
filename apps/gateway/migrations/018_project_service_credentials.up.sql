CREATE TABLE project_service_credentials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL, framework_id text NOT NULL, project_id text NOT NULL,
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(expires_at>created_at)
);
REVOKE ALL ON project_service_credentials FROM PUBLIC,unify_hermes_adapter_runtime;
