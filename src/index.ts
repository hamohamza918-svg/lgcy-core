// Silence the single experimental warning from node:sqlite so logs stay clean;
// all other warnings still surface.
const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const msg = typeof warning === 'string' ? warning : warning.message;
  if (msg.includes('SQLite is an experimental feature')) return;
  // @ts-expect-error passthrough of variadic warning args
  return originalEmitWarning(warning, ...rest);
}) as typeof process.emitWarning;

import { loadEnv } from './config/env.js';
import { credentials } from './config/credentials.js';
import { getGuildConfig, updateGuildConfig } from './config/guildConfig.js';
import { logger } from './utils/logger.js';
import { initDatabase, closeDatabase } from './database/index.js';
import { LgcyClient } from './services/client.js';
import { loadModules } from './services/moduleLoader.js';
import { startKeepAlive } from './services/keepalive.js';
import { MODULES } from './modules/index.js';
import { readyEvent } from './events/ready.js';
import { interactionCreateEvent } from './events/interactionCreate.js';

/**
 * Restore channel config from env when it's missing from the DB. Essential for
 * hosts without a persistent disk (e.g. Render free), where the SQLite file
 * resets on every restart — this re-applies the welcome channels on each boot so
 * the bot self-heals instead of losing its setup. Only fills gaps; never
 * overrides values changed at runtime during a continuous run.
 */
function seedConfigFromEnv(): void {
  const gid = credentials.getGuildId();
  if (!gid) return;
  const env = loadEnv();
  if (!env.WELCOME_CHANNEL_ID && !env.RULES_CHANNEL_ID && !env.ROLES_CHANNEL_ID) return;
  const cfg = getGuildConfig(gid);
  const seeded: string[] = [];
  updateGuildConfig(gid, (draft) => {
    if (env.WELCOME_CHANNEL_ID && !cfg.welcomeChannelId) { draft.welcomeChannelId = env.WELCOME_CHANNEL_ID; seeded.push('welcome'); }
    if (env.RULES_CHANNEL_ID && !cfg.rulesChannelId) { draft.rulesChannelId = env.RULES_CHANNEL_ID; seeded.push('rules'); }
    if (env.ROLES_CHANNEL_ID && !cfg.rolesChannelId) { draft.rolesChannelId = env.ROLES_CHANNEL_ID; seeded.push('roles'); }
  });
  if (seeded.length) logger.info({ seeded }, 'seeded channel config from env');
}

async function main(): Promise<void> {
  // 1. Validate environment up-front — fail fast with a readable message.
  const env = loadEnv();
  logger.info({ env: env.NODE_ENV }, 'starting LGCY Core');

  // 2. Database + migrations (also required before reading managed credentials).
  initDatabase();
  seedConfigFromEnv(); // restore channel config from env on disk-less hosts

  // 2b. Keep-alive HTTP server (only when PORT is set — Render / UptimeRobot).
  startKeepAlive();

  // 3. Client + modules.
  const client = new LgcyClient();
  await loadModules(client, MODULES);

  // 4. Core gateway events (feature events are wired by the module loader).
  client.once(readyEvent.name, (...args) => readyEvent.execute(client, ...args));
  client.on(interactionCreateEvent.name, (...args) =>
    interactionCreateEvent.execute(client, ...args),
  );

  client.on('error', (err) => logger.error({ err }, 'client error'));
  client.on('warn', (msg) => logger.warn({ msg }, 'client warning'));

  // 5. Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    try {
      await client.destroy();
      closeDatabase();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) =>
    logger.error({ reason }, 'unhandled promise rejection'),
  );

  // 6. Connect (token from the Control Center's secret store, or env fallback).
  const token = credentials.getToken();
  if (!token) {
    throw new Error(
      'No bot token configured. Set it in the Control Center (npm run control) or DISCORD_TOKEN in .env.',
    );
  }
  await client.login(token);
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal error during startup');
  process.exit(1);
});
