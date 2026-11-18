-- V4 adds explicitly shared project notes and their embedded image assets.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 7) THEN
        ALTER TABLE publications DROP CONSTRAINT publications_snapshot_check;
        ALTER TABLE publications ADD CONSTRAINT publications_snapshot_check
            CHECK ((snapshot->>'formatVersion')::integer IN (1, 2, 3, 4));
        INSERT INTO protoflow_schema_migrations(version) VALUES (7);
    END IF;
END $$;
