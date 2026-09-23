import type { DatabaseSync } from 'node:sqlite';
import { scopedLogger } from '../../utils/logger.js';
import { migration001 } from './001_init.js';
import { migration002 } from './002_tickets.js';
import { migration003 } from './003_app_settings.js';
import { migration004 } from './004_control_center.js';

const log = scopedLogger('migrations');

export interface Migration {
  version: number;
  name: string;
  up(db: DatabaseSync): void;
}

/**
 * Ordered list of migrations. To evolve the schema later, append a new file
 * (e.g. 002_xp.ts) and add it here — never edit an already-applied migration.
 * This gives us forward-only, versioned schema growth.
 */
const MIGRATIONS: Migration[] = [migration001, migration002, migration003, migration004];

/** The highest schema version this codebase knows about. */
export function latestSchemaVersion(): number {
  return Math.max(...MIGRATIONS.map((m) => m.version));
}

/** The schema version currently applied in the given database. */
export function appliedSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM _migrations').get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

/** Migration entries newer than the applied version (name + version only). */
export function pendingMigrations(db: DatabaseSync): { version: number; name: string }[] {
  const current = appliedSchemaVersion(db);
  return MIGRATIONS.filter((m) => m.version > current).map((m) => ({ version: m.version, name: m.name }));
}

/** Applies any pending migrations and returns the resulting schema version. */
export function runMigrations(db: DatabaseSync): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = db
    .prepare('SELECT MAX(version) AS v FROM _migrations')
    .get() as { v: number | null };
  const current = row?.v ?? 0;

  const pending = MIGRATIONS.filter((m) => m.version > current).sort(
    (a, b) => a.version - b.version,
  );

  if (pending.length === 0) {
    return current;
  }

  for (const m of pending) {
    log.info({ version: m.version, name: m.name }, 'applying migration');
    // node:sqlite has no nested-transaction helper; wrap manually.
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare('INSERT INTO _migrations (version, name) VALUES (?, ?)').run(
        m.version,
        m.name,
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      log.error({ err, version: m.version }, 'migration failed — rolled back');
      throw err;
    }
  }

  return MIGRATIONS[MIGRATIONS.length - 1]!.version;
}
