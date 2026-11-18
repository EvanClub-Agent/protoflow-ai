-- 001 generated publications_snapshot_check for its formatVersion=1 check.
-- Expand that exact constraint, preserving publication identities and content.
CREATE TABLE IF NOT EXISTS protoflow_schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 2) THEN
        ALTER TABLE publications DROP CONSTRAINT publications_snapshot_check;
        ALTER TABLE publications ADD CONSTRAINT publications_snapshot_check
            CHECK ((snapshot->>'formatVersion')::integer IN (1, 2));
        INSERT INTO protoflow_schema_migrations(version) VALUES (2);
    END IF;
END $$;
