-- Initial website schema. Apply on a direct PostgreSQL connection.
CREATE TABLE IF NOT EXISTS admins(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,admin_id BIGINT REFERENCES admins(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);
 CREATE TABLE IF NOT EXISTS demo_requests(id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,organisation TEXT NOT NULL,email TEXT NOT NULL,phone TEXT DEFAULT '',country TEXT DEFAULT '',solution TEXT DEFAULT '',industry TEXT DEFAULT '',size TEXT DEFAULT '',problem TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new',notes TEXT DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS assistant_logs(id BIGSERIAL PRIMARY KEY,question TEXT NOT NULL,answer TEXT NOT NULL,source TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS advisor_logs(id BIGSERIAL PRIMARY KEY,problem TEXT NOT NULL,solution TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE IF NOT EXISTS website_migrations (version TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX IF NOT EXISTS demo_requests_created_at_idx ON demo_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS demo_requests_status_idx ON demo_requests(status);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS assistant_logs_created_at_idx ON assistant_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS advisor_logs_created_at_idx ON advisor_logs(created_at DESC);
INSERT INTO website_migrations(version) VALUES ('001_initial') ON CONFLICT(version) DO NOTHING;

