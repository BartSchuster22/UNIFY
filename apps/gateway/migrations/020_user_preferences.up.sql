CREATE TABLE user_time_preferences (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 timezone text NOT NULL CHECK(length(timezone) BETWEEN 1 AND 100),
 updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON user_time_preferences FROM PUBLIC, unify_hermes_adapter_runtime;
