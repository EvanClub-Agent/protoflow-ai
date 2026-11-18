-- V4 adds platform_admins, client_users, desktop_releases, and desktop_release_assets.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 4) THEN
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

        CREATE TABLE IF NOT EXISTS desktop_releases (
            id text PRIMARY KEY,
            admin_id text NOT NULL REFERENCES platform_admins(id),
            version text NOT NULL UNIQUE,
            title text NOT NULL,
            notes text NOT NULL DEFAULT '',
            channel text NOT NULL DEFAULT 'stable' CHECK (channel IN ('stable', 'beta')),
            mandatory boolean NOT NULL DEFAULT false,
            published boolean NOT NULL DEFAULT true,
            published_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS desktop_releases_published_idx ON desktop_releases(published, channel, published_at DESC);

        CREATE TABLE IF NOT EXISTS desktop_release_assets (
            id text PRIMARY KEY,
            release_id text NOT NULL REFERENCES desktop_releases(id) ON DELETE CASCADE,
            os text NOT NULL CHECK (os IN ('windows', 'macos', 'linux')),
            arch text NOT NULL CHECK (arch IN ('x64', 'arm64', 'universal')),
            package_type text NOT NULL CHECK (package_type IN ('exe', 'dmg', 'zip', 'deb', 'AppImage', 'tar.gz')),
            file_name text NOT NULL,
            size_bytes bigint NOT NULL CHECK (size_bytes > 0),
            sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
            storage_path text NOT NULL DEFAULT '',
            external_url text NOT NULL DEFAULT '',
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE (release_id, os, arch, package_type)
        );
        CREATE INDEX IF NOT EXISTS desktop_release_assets_release_idx ON desktop_release_assets(release_id);

        INSERT INTO protoflow_schema_migrations(version) VALUES (4);
    END IF;
END $$;
