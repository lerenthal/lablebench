import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { migrations } from "./schema.js";

export type Db = Database.Database;

export type DbOptions = {
  /** Path to the SQLite file, or ":memory:" for an ephemeral database. */
  path: string;
};

/**
 * Open the database, apply pending migrations, return a ready handle.
 */
export function openDb(options: DbOptions): Db {
  const { path } = options;

  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);

  // WAL keeps readers (the SPA polling template lists) from blocking the writer.
  if (path !== ":memory:") {
    db.pragma("journal_mode = WAL");
  }
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db);

  return db;
}

/**
 * Apply any migration that has not run yet. Each migration runs inside its own
 * transaction so a failure cannot leave a half-applied schema behind.
 */
export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare("SELECT id FROM schema_migrations").all().map((row) => (row as { id: string }).id),
  );

  const record = db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");

  for (const migration of migrations) {
    if (applied.has(migration.id)) {
      continue;
    }

    const run = db.transaction(() => {
      migration.up(db);
      record.run(migration.id, new Date().toISOString());
    });

    run();
  }
}

/**
 * Resolve a path inside the configured data directory, refusing to escape it.
 * Used for the asset directory so a crafted filename cannot traverse out of the root.
 */
export function resolveInside(root: string, relative: string): string {
  const rootAbs = isAbsolute(root) ? root : resolve(root);
  const target = resolve(rootAbs, relative);

  if (target !== rootAbs && !target.startsWith(rootAbs + "/")) {
    throw new Error("Path escapes the data directory");
  }

  return target;
}
