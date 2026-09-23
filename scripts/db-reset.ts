/**
 * Deletes the local SQLite database file so the next start re-runs migrations
 * from scratch. Dev convenience only. Run: `npm run db:reset`.
 */
import { rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv } from '../src/config/env.js';

const env = loadEnv();
const path = resolve(process.cwd(), env.DATABASE_PATH);
for (const f of [path, `${path}-wal`, `${path}-shm`, `${path}-journal`]) {
  if (existsSync(f)) {
    rmSync(f);
    // eslint-disable-next-line no-console
    console.log(`removed ${f}`);
  }
}
// eslint-disable-next-line no-console
console.log('database reset — migrations will run on next start');
