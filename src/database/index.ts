import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnv } from '../config/env.js';
import { scopedLogger } from '../utils/logger.js';
import { runMigrations } from './migrations/index.js';

const log = scopedLogger('database');

/**
 * The database handle is intentionally the ONLY place that talks to the SQLite
 * driver. Everything else goes through repositories, so swapping the engine
 * (e.g. to Postgres or better-sqlite3) later touches only this folder.
 */
export type Db = DatabaseSync;

let db: Db | null = null;

export function getDb(): Db {
  if (!db) {
    throw new Error('Database not initialized — call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): Db {
  if (db) return db;
  const env = loadEnv();
  const path = resolve(process.cwd(), env.DATABASE_PATH);
  mkdirSync(dirname(path), { recursive: true });

  db = new DatabaseSync(path);
  // Pragmas: WAL for concurrent reads, foreign keys for integrity.
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');

  const version = runMigrations(db);
  log.info({ path, schemaVersion: version }, 'database ready');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    log.info('database closed');
  }
}
