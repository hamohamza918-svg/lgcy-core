/**
 * Offline smoke test — boots everything EXCEPT the Discord login: runs
 * migrations, builds the client, loads all modules, and prints the resulting
 * command/module/event inventory. Verifies the core wiring without a token.
 * Run: `npm run smoke`.
 */
process.env.DISCORD_TOKEN ??= 'smoke-test-token';
process.env.DISCORD_CLIENT_ID ??= '000000000000000000';
process.env.GUILD_ID ??= '000000000000000000';
// Force an isolated DB (override .env) so the smoke test never touches live data.
process.env.DATABASE_PATH = 'data/smoke.sqlite';

import { initDatabase, closeDatabase } from '../src/database/index.js';
import { LgcyClient } from '../src/services/client.js';
import { loadModules } from '../src/services/moduleLoader.js';
import { MODULES } from '../src/modules/index.js';

async function main(): Promise<void> {
  initDatabase();
  const client = new LgcyClient();
  await loadModules(client, MODULES);

  const events = MODULES.flatMap((m) => m.events ?? []).length;
  /* eslint-disable no-console */
  console.log('\n──────── LGCY CORE SMOKE TEST ────────');
  console.log(`Modules loaded : ${client.modules.size}`);
  console.log(`Commands       : ${client.commands.size}`);
  console.log(`Feature events : ${events}`);
  console.log(`Intents        : ${client.options.intents.bitfield}`);
  console.log('\nCommands:');
  console.log('  ' + [...client.commands.keys()].sort().join(', '));
  console.log('\nModules:');
  for (const m of client.modules.values()) {
    console.log(`  ${m.defaultEnabled ? '🟢' : '⚪'} ${m.name.padEnd(11)} — ${m.description}`);
  }
  console.log('\n✓ Core wiring OK (no Discord connection was made).');
  /* eslint-enable no-console */

  closeDatabase();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('smoke test failed:', err);
  process.exit(1);
});
