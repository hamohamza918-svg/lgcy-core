// Silence the node:sqlite experimental warning for clean output.
const _emit = process.emitWarning.bind(process);
process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
  const m = typeof w === 'string' ? w : w.message;
  if (m.includes('SQLite is an experimental feature')) return;
  // @ts-expect-error variadic passthrough
  return _emit(w, ...rest);
}) as typeof process.emitWarning;

import type { Server } from 'node:http';
import { initDatabase, closeDatabase } from '../../src/database/index.js';
import { scopedLogger } from '../../src/utils/logger.js';
import { APP_VERSION } from '../../src/config/version.js';
import { secretStore } from '../../src/services/secretStore.js';
import { createApp } from './app.js';
import { HOST, PORT } from './security.js';
import { databaseService } from './services/databaseService.js';

const log = scopedLogger('control-center');

function banner(dbHealthy: boolean): void {
  const prov = secretStore.meta().provider;
  const lines = [
    '',
    '  LGCY CONTROL CENTER',
    '  ━━━━━━━━━━━━━━━━━━━━',
    '',
    `  Dashboard:       http://${HOST}:${PORT}`,
    '  Mode:            LOCAL / MOCK',
    '  Discord:         NOT CONNECTED',
    `  Secret Storage:  ${prov.label} (${prov.status})`,
    `  Database:        ${dbHealthy ? 'HEALTHY' : 'ERROR'}`,
    `  Version:         v${APP_VERSION}`,
    '',
    '  Press Ctrl+C to stop.',
    '',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
  if (prov.status !== 'SECURE') {
    // eslint-disable-next-line no-console
    console.log(`  ⚠️  SECURITY: ${prov.warning}\n`);
  }
}

function main(): void {
  // Crash guards: a stray async error must never silently kill the dashboard.
  process.on('uncaughtException', (err) => log.error({ err: err.message }, 'uncaught exception (kept running)'));
  process.on('unhandledRejection', (reason) => log.error({ reason: String(reason) }, 'unhandled rejection (kept running)'));

  // The Control Center never connects to Discord — it only needs the local DB.
  initDatabase();
  let dbHealthy = true;
  try { dbHealthy = databaseService.stats().healthy; } catch { dbHealthy = false; }

  const app = createApp();
  const server: Server = app.listen(PORT, HOST, () => {
    log.info({ url: `http://${HOST}:${PORT}` }, 'LGCY Control Center running (local-only, no Discord connection)');
    banner(dbHealthy);
  });

  // Graceful shutdown: close the HTTP server, then DB handles. (A future live
  // bot connection would also be destroyed here.)
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log(`\n  Shutting down (${signal})…`);
    server.close(() => {
      closeDatabase();
      // eslint-disable-next-line no-console
      console.log('  Stopped cleanly.');
      process.exit(0);
    });
    // Safety net if close hangs.
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Test hook: exercise the exact graceful-shutdown path without relying on OS
  // signal delivery (unreliable for child processes on Windows/Git-bash).
  if (process.env.LGCY_SELFTEST_SHUTDOWN === '1') {
    setTimeout(() => shutdown('SELFTEST'), 1500);
  }
}

main();
