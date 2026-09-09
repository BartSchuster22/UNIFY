CREATE TABLE oidc_identities (
 issuer text NOT NULL, subject text NOT NULL, user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(issuer,subject)
);
CREATE TABLE oidc_flows (state_hash text PRIMARY KEY CHECK(length(state_hash)=64), sealed text NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX oidc_flow_expiry ON oidc_flows(expires_at);
CREATE TABLE oidc_session_tokens (session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, subject text NOT NULL, sealed text NOT NULL);
REVOKE ALL ON oidc_identities,oidc_flows,oidc_session_tokens FROM PUBLIC,unify_hermes_adapter_runtime;
