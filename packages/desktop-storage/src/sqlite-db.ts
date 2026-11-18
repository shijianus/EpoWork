import fs from "node:fs";
import path from "node:path";
import type * as NodeSqlite from "node:sqlite";
import type { D1DatabaseLike, D1PreparedStatementLike } from "@ai-workspace/database";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof NodeSqlite;

export const LOCAL_DESKTOP_USER_ID = "usr_local_desktop";

/**
 * Wraps Node 22+ built-in `node:sqlite` (`DatabaseSync`) behind `D1DatabaseLike` for zero-native-rebuild Desktop storage.
 */
export function openDesktopSqlite(
  dbPath: string,
  migrationsDir: string,
): {
  db: D1DatabaseLike;
  raw: NodeSqlite.DatabaseSync;
  close: () => void;
} {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS _local_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const applied = sqlite
      .prepare("SELECT name FROM _local_migrations WHERE name = ? LIMIT 1")
      .get(file) as { name: string } | undefined;
    if (applied) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    sqlite.exec(sql);
    sqlite
      .prepare("INSERT INTO _local_migrations (name, applied_at) VALUES (?, ?)")
      .run(file, new Date().toISOString());
  }

  // Ensure default local desktop profile exists for foreign-key consistency
  const existingUser = sqlite
    .prepare("SELECT id FROM users WHERE id = ? LIMIT 1")
    .get(LOCAL_DESKTOP_USER_ID) as { id: string } | undefined;
  if (!existingUser) {
    const now = new Date().toISOString();
    sqlite
      .prepare(
        `INSERT INTO users (id, email, display_name, password_hash, password_salt, theme_preference, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'system', ?, ?)`,
      )
      .run(
        LOCAL_DESKTOP_USER_ID,
        "local@epocanvas.desktop",
        "Local Workspace",
        "desktop-local",
        "desktop-local",
        now,
        now,
      );
  }

  const makeStmt = (sql: string, params: unknown[] = []): D1PreparedStatementLike => ({
    bind: (...values: unknown[]) => makeStmt(sql, values),
    first: async <T>(colName?: string): Promise<T | null> => {
      const row = sqlite.prepare(sql).get(...(params as never[])) as
        Record<string, unknown> | undefined;
      if (!row) return null;
      if (colName) return (row[colName] as T) ?? null;
      return row as T;
    },
    all: async <T>() => {
      const rows = sqlite.prepare(sql).all(...(params as never[])) as T[];
      return { results: rows };
    },
    run: async () => {
      const info = sqlite.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });

  return {
    db: { prepare: (q: string) => makeStmt(q) },
    raw: sqlite,
    close: () => sqlite.close(),
  };
}
