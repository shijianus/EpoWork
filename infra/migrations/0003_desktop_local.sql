-- 0003_desktop_local.sql — Desktop-local project root path & run event extensions

CREATE TABLE IF NOT EXISTS desktop_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,
  template TEXT NOT NULL DEFAULT 'blank',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_desktop_projects_updated ON desktop_projects(updated_at DESC);
