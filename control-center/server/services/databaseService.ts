import { statSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getDb } from '../../../src/database/index.js';
import {
  latestSchemaVersion,
  appliedSchemaVersion,
  runMigrations,
  pendingMigrations,
} from '../../../src/database/migrations/index.js';
import { loadEnv } from '../../../src/config/env.js';

function dbPath(): string {
  return resolve(process.cwd(), loadEnv().DATABASE_PATH);
}

function count(sql: string): number {
  try {
    return (getDb().prepare(sql).get() as { c: number }).c;
  } catch {
    return 0;
  }
}

export const databaseService = {
  stats() {
    const db = getDb();
    const path = dbPath();
    const size = existsSync(path) ? statSync(path).size : 0;
    const last = db
      .prepare('SELECT name, version, applied_at FROM _migrations ORDER BY version DESC LIMIT 1')
      .get() as { name: string; version: number; applied_at: string } | undefined;
    return {
      healthy: true,
      schemaVersion: appliedSchemaVersion(db),
      latestSchemaVersion: latestSchemaVersion(),
      pending: pendingMigrations(db),
      sizeBytes: size,
      counts: {
        modCases: count('SELECT COUNT(*) AS c FROM mod_cases'),
        tickets: count('SELECT COUNT(*) AS c FROM tickets'),
        guildConfigs: count('SELECT COUNT(*) AS c FROM guild_config'),
        appSettings: count('SELECT COUNT(*) AS c FROM app_settings'),
      },
      lastMigration: last ?? null,
    };
  },

  /** Copies the SQLite file to a timestamped backup. Safe, local only. */
  backup(): { path: string; sizeBytes: number } {
    const db = getDb();
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);'); // flush WAL so the copy is complete
    const src = dbPath();
    const dir = resolve(process.cwd(), 'backups', 'db');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = join(dir, `lgcy-core-${stamp}.sqlite`);
    copyFileSync(src, dest);
    return { path: dest, sizeBytes: statSync(dest).size };
  },

  /** Applies any pending migrations (idempotent — normally already applied). */
  migrate(): { schemaVersion: number } {
    return { schemaVersion: runMigrations(getDb()) };
  },
};
