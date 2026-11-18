CREATE TABLE IF NOT EXISTS diagnostic_installations (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS runtime_diagnostics (
    id uuid PRIMARY KEY,
    installation_id uuid NOT NULL REFERENCES diagnostic_installations(id),
    received_at timestamptz NOT NULL DEFAULT now(),
    occurred_at timestamptz NOT NULL,
    category text NOT NULL,
    app_version text NOT NULL,
    report jsonb NOT NULL CHECK (octet_length(report::text) <= 65536)
);
CREATE INDEX IF NOT EXISTS runtime_diagnostics_received_idx ON runtime_diagnostics(received_at DESC, id);
CREATE INDEX IF NOT EXISTS runtime_diagnostics_category_idx ON runtime_diagnostics(category, received_at DESC);
CREATE INDEX IF NOT EXISTS runtime_diagnostics_version_idx ON runtime_diagnostics(app_version, received_at DESC);
CREATE INDEX IF NOT EXISTS runtime_diagnostics_installation_idx ON runtime_diagnostics(installation_id);
CREATE INDEX IF NOT EXISTS diagnostic_installations_created_idx ON diagnostic_installations(created_at);
INSERT INTO protoflow_schema_migrations(version) VALUES (8) ON CONFLICT DO NOTHING;
