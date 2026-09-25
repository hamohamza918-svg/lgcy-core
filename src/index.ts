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
import { maybeGrantChannels } from './services/grantChannels.js';
import { maybePostLogSamples } from './services/logSamples.js';
import { maybePostTicketPanel } from './services/ticketPanel.js';
import { maybeCreateTicketLog } from './services/ticketLogSetup.js';
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
  const anyWelcome = env.WELCOME_CHANNEL_ID || env.RULES_CHANNEL_ID || env.ROLES_CHANNEL_ID || env.AUTO_ROLE_IDS;
  const anyLog = env.LOG_MEMBER_CHANNEL_ID || env.LOG_MESSAGE_CHANNEL_ID || env.LOG_ROLE_CHANNEL_ID
    || env.LOG_VOICE_CHANNEL_ID || env.LOG_SERVER_CHANNEL_ID || env.LOG_MODERATION_CHANNEL_ID;
  const anyTicket = env.TICKET_PANEL_CHANNEL_ID || env.TICKET_PARENT_CATEGORY_ID || env.TICKET_LOG_CHANNEL_ID
    || env.TICKET_ARCHIVE_CATEGORY_ID || env.TICKET_STAFF_ROLE_IDS;
  const anyFile = env.FILE_LOG_POSTED_CHANNEL_ID || env.FILE_LOG_DELETED_CHANNEL_ID;
  if (!anyWelcome && !anyLog && !anyTicket && !anyFile && !env.LOG_MESSAGE_SENDS) return;
  const cfg = getGuildConfig(gid);
  const seeded: string[] = [];
  updateGuildConfig(gid, (draft) => {
    if (env.WELCOME_CHANNEL_ID && !cfg.welcomeChannelId) { draft.welcomeChannelId = env.WELCOME_CHANNEL_ID; seeded.push('welcome'); }
    if (env.RULES_CHANNEL_ID && !cfg.rulesChannelId) { draft.rulesChannelId = env.RULES_CHANNEL_ID; seeded.push('rules'); }
    if (env.ROLES_CHANNEL_ID && !cfg.rolesChannelId) { draft.rolesChannelId = env.ROLES_CHANNEL_ID; seeded.push('roles'); }
    if (env.AUTO_ROLE_IDS && cfg.autoRoleIds.length === 0) { draft.autoRoleIds = env.AUTO_ROLE_IDS.split(',').map((s) => s.trim()).filter(Boolean); seeded.push('autoRoles'); }
    if (env.LOG_MEMBER_CHANNEL_ID && !cfg.logChannels.member) { draft.logChannels.member = env.LOG_MEMBER_CHANNEL_ID; seeded.push('log:member'); }
    if (env.LOG_MESSAGE_CHANNEL_ID && !cfg.logChannels.message) { draft.logChannels.message = env.LOG_MESSAGE_CHANNEL_ID; seeded.push('log:message'); }
    if (env.LOG_ROLE_CHANNEL_ID && !cfg.logChannels.role) { draft.logChannels.role = env.LOG_ROLE_CHANNEL_ID; seeded.push('log:role'); }
    if (env.LOG_VOICE_CHANNEL_ID && !cfg.logChannels.voice) { draft.logChannels.voice = env.LOG_VOICE_CHANNEL_ID; seeded.push('log:voice'); }
    if (env.LOG_SERVER_CHANNEL_ID && !cfg.logChannels.server) { draft.logChannels.server = env.LOG_SERVER_CHANNEL_ID; seeded.push('log:server'); }
    if (env.LOG_MODERATION_CHANNEL_ID && !cfg.logChannels.moderation) { draft.logChannels.moderation = env.LOG_MODERATION_CHANNEL_ID; seeded.push('log:moderation'); }
    if (env.TICKET_PANEL_CHANNEL_ID && !cfg.ticketPanelChannelId) { draft.ticketPanelChannelId = env.TICKET_PANEL_CHANNEL_ID; seeded.push('ticket:panel'); }
    if (env.TICKET_PARENT_CATEGORY_ID && !cfg.ticketParentCategoryId) { draft.ticketParentCategoryId = env.TICKET_PARENT_CATEGORY_ID; seeded.push('ticket:parent'); }
    if (env.TICKET_LOG_CHANNEL_ID && !cfg.ticketLogChannelId) { draft.ticketLogChannelId = env.TICKET_LOG_CHANNEL_ID; seeded.push('ticket:log'); }
    if (env.TICKET_ARCHIVE_CATEGORY_ID && !cfg.ticketArchiveCategoryId) { draft.ticketArchiveCategoryId = env.TICKET_ARCHIVE_CATEGORY_ID; seeded.push('ticket:archive'); }
    if (env.TICKET_STAFF_ROLE_IDS && cfg.ticketStaffRoleIds.length === 0) {
      draft.ticketStaffRoleIds = env.TICKET_STAFF_ROLE_IDS.split(',').map((s) => s.trim()).filter(Boolean);
      seeded.push('ticket:staff');
    }
    if (env.LOG_MESSAGE_SENDS === '1' && !cfg.logging.logMessageSends) { draft.logging.logMessageSends = true; seeded.push('log:messageSends'); }
    if (env.FILE_LOG_POSTED_CHANNEL_ID && !cfg.fileLog.postedChannelId) { draft.fileLog.postedChannelId = env.FILE_LOG_POSTED_CHANNEL_ID; seeded.push('file:posted'); }
    if (env.FILE_LOG_DELETED_CHANNEL_ID && !cfg.fileLog.deletedChannelId) { draft.fileLog.deletedChannelId = env.FILE_LOG_DELETED_CHANNEL_ID; seeded.push('file:deleted'); }
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
  // One-time channel-access bootstrap (only acts when GRANT_CHANNELS=1).
  client.once(readyEvent.name, async () => {
    try {
      const gid = credentials.getGuildId();
      const guild = gid ? await client.guilds.fetch(gid) : null;
      if (guild) {
        await maybeGrantChannels(guild);
        await maybePostLogSamples(guild);
        await maybeCreateTicketLog(guild);
        await maybePostTicketPanel(guild);
      }
    } catch (err) {
      logger.error({ err }, 'channel grant bootstrap failed');
    }
  });
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
