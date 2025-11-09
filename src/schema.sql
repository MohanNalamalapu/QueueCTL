PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 3000;


CREATE TABLE IF NOT EXISTS jobs (
id TEXT PRIMARY KEY,
command TEXT NOT NULL,
state TEXT NOT NULL CHECK (state IN ('pending','processing','completed','failed','dead')),
attempts INTEGER NOT NULL DEFAULT 0,
max_retries INTEGER NOT NULL DEFAULT 3,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
run_at TEXT NULL,
last_error TEXT NULL,
priority INTEGER NOT NULL DEFAULT 0,
locked_by TEXT NULL,
lock_until TEXT NULL
);


CREATE INDEX IF NOT EXISTS idx_jobs_state_runat ON jobs(state, run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority DESC, created_at);


CREATE TABLE IF NOT EXISTS dlq (
id TEXT PRIMARY KEY,
job_id TEXT NOT NULL,
payload TEXT NOT NULL,
dead_at TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS config (
key TEXT PRIMARY KEY,
value TEXT NOT NULL
);


CREATE TABLE IF NOT EXISTS workers (
id TEXT PRIMARY KEY,
pid INTEGER NOT NULL,
started_at TEXT NOT NULL,
heartbeat_at TEXT NOT NULL
);