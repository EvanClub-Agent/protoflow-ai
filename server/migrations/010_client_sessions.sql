-- Desktop and release-center sign-ins have independent sessions. Preserve all
-- pre-existing credentials and their original expiry, without rebinding users.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 10) THEN
        CREATE TABLE client_sessions (
            token_hash text PRIMARY KEY,
            user_id text NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
            expires_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX client_sessions_user_idx ON client_sessions(user_id);
        INSERT INTO client_sessions(token_hash,user_id,expires_at)
            SELECT token_hash,id,token_expires_at FROM client_users WHERE token_hash <> '';
        INSERT INTO protoflow_schema_migrations(version) VALUES (10);
    END IF;
END $$;
