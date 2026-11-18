-- V3 stores the exact designer menu tree, including document and empty entries.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 3) THEN
        ALTER TABLE publications DROP CONSTRAINT publications_snapshot_check;
        ALTER TABLE publications ADD CONSTRAINT publications_snapshot_check
            CHECK ((snapshot->>'formatVersion')::integer IN (1, 2, 3));
        INSERT INTO protoflow_schema_migrations(version) VALUES (3);
    END IF;
END $$;
