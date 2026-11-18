CREATE TABLE IF NOT EXISTS publishers (
    id text PRIMARY KEY,
    name text NOT NULL,
    token_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publications (
    id text PRIMARY KEY,
    publisher_id text NOT NULL REFERENCES publishers(id),
    project_id text NOT NULL,
    title text NOT NULL,
    snapshot jsonb NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    password_hash text NOT NULL DEFAULT '',
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (snapshot->>'projectId' = project_id),
    CHECK ((snapshot->>'formatVersion')::integer = 1)
);
CREATE INDEX IF NOT EXISTS publications_owner_project ON publications(publisher_id, project_id, created_at DESC);
