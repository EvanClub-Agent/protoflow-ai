-- Preserve existing publication ownership. Accounts bind explicitly, never by project ID.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM protoflow_schema_migrations WHERE version = 9) THEN
        CREATE UNIQUE INDEX client_users_publisher_unique ON client_users(publisher_id) WHERE publisher_id IS NOT NULL;
        INSERT INTO protoflow_schema_migrations(version) VALUES (9);
    END IF;
END $$;
