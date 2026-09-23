/**
 * Registers all slash commands with Discord via the REST API.
 *
 * NOTE: This talks to Discord. It is NOT run automatically. Run it manually
 * (`npm run deploy-commands`) only once you're ready to connect LGCY Core to a
 * server. With COMMAND_SCOPE=guild it registers to GUILD_ID instantly; with
 * "global" it registers globally (up to ~1h propagation).
 */
import { REST, Routes } from 'discord.js';
import { loadEnv } from '../src/config/env.js';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';
import { MODULES } from '../src/modules/index.js';
import { logger } from '../src/utils/logger.js';

async function deploy(): Promise<void> {
  const env = loadEnv();
  initDatabase();
  const token = credentials.getToken();
  const clientId = credentials.getApplicationId();
  const guildId = credentials.getGuildId();
  if (!token || !clientId) throw new Error('Token and Application ID are required (set them in the Control Center).');

  const body = MODULES.flatMap((m) => m.commands ?? []).map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);
  logger.info({ count: body.length, scope: env.COMMAND_SCOPE }, 'deploying commands');

  if (env.COMMAND_SCOPE === 'guild') {
    if (!guildId) throw new Error('Guild ID required for guild-scope deploy');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    logger.info({ guildId }, 'guild commands deployed');
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    logger.info('global commands deployed');
  }
}

deploy().catch((err) => {
  logger.fatal({ err }, 'command deploy failed');
  process.exit(1);
});
