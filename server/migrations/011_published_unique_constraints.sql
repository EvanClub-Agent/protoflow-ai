-- V5 preserves column-level isUnique and table-level uniqueConstraints in published snapshots.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 11) THEN
        ALTER TABLE publications DROP CONSTRAINT publications_snapshot_check;
        ALTER TABLE publications ADD CONSTRAINT publications_snapshot_check
            CHECK ((snapshot->>'formatVersion')::integer IN (1, 2, 3, 4, 5));
        INSERT INTO protoflow_schema_migrations(version) VALUES (11);
    END IF;
END $$;
