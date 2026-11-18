-- Upgrade desktop_release_assets to require explicit platform_admin approval bound to asset SHA-256 before signing or public distribution.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 6) THEN
        ALTER TABLE desktop_release_assets
            ADD COLUMN IF NOT EXISTS approved_by_admin_id text REFERENCES platform_admins(id) ON DELETE SET NULL,
            ADD COLUMN IF NOT EXISTS approved_sha256 text NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS approved_at timestamptz;

        -- Existing historical assets must stay in pending-approval state until an admin explicitly approves them.
        UPDATE desktop_release_assets
        SET approved_by_admin_id = NULL,
            approved_sha256 = '',
            approved_at = NULL;

        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'desktop_release_assets'::regclass
              AND conname = 'desktop_release_assets_approval_check'
        ) THEN
            ALTER TABLE desktop_release_assets
                ADD CONSTRAINT desktop_release_assets_approval_check
                CHECK (
                    approved_by_admin_id IS NULL
                    OR (
                        approved_sha256 ~ '^[A-Fa-f0-9]{64}$'
                        AND size_bytes > 0
                    )
                );
        END IF;

        INSERT INTO protoflow_schema_migrations (version)
        VALUES (6)
        ON CONFLICT (version) DO NOTHING;
    END IF;
END $$;
