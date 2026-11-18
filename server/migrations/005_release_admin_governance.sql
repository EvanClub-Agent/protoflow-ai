-- V5 upgrades both the legacy V4 (publisher_id) and current V4 (admin_id) schemas
-- to preserve legacy release ownership while requiring platform_admins for new releases.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 5) THEN
        CREATE TABLE IF NOT EXISTS platform_admins (
            id text PRIMARY KEY,
            username text NOT NULL UNIQUE,
            display_name text NOT NULL,
            password_hash text NOT NULL,
            token_hash text NOT NULL DEFAULT '',
            token_expires_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS platform_admins_token_idx ON platform_admins(token_hash) WHERE token_hash <> '';

        CREATE TABLE IF NOT EXISTS client_users (
            id text PRIMARY KEY,
            username text NOT NULL UNIQUE,
            display_name text NOT NULL,
            password_hash text NOT NULL,
            token_hash text NOT NULL DEFAULT '',
            token_expires_at timestamptz,
            publisher_id text REFERENCES publishers(id),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS client_users_token_idx ON client_users(token_hash) WHERE token_hash <> '';

        ALTER TABLE desktop_releases
            ADD COLUMN IF NOT EXISTS publisher_id text REFERENCES publishers(id),
            ADD COLUMN IF NOT EXISTS admin_id text REFERENCES platform_admins(id);

        ALTER TABLE desktop_releases
            ALTER COLUMN publisher_id DROP NOT NULL,
            ALTER COLUMN admin_id DROP NOT NULL;

        ALTER TABLE desktop_releases
            DROP CONSTRAINT IF EXISTS desktop_releases_owner_check;
        ALTER TABLE desktop_releases
            ADD CONSTRAINT desktop_releases_owner_check
            CHECK (admin_id IS NOT NULL OR publisher_id IS NOT NULL);

        ALTER TABLE desktop_release_assets
            DROP CONSTRAINT IF EXISTS desktop_release_assets_digest_check;
        ALTER TABLE desktop_release_assets
            ADD CONSTRAINT desktop_release_assets_digest_check
            CHECK (size_bytes > 0 AND sha256 ~ '^[a-f0-9]{64}$') NOT VALID;

        INSERT INTO protoflow_schema_migrations(version) VALUES (5);
    END IF;
END $$;
