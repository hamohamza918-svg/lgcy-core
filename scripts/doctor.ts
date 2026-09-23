/**
 * LGCY CORE — first-login doctor (Step 4).
 *
 * Connects to the gateway and reports a diagnostic ONLY. It does not deploy
 * commands, wire feature event handlers, post messages, create channels, or
 * modify roles/permissions — it just reads and validates, then disconnects.
 *
 * Run (after filling .env): `npm run doctor`.
 */
import { IntentsBitField, Events } from 'discord.js';
import { loadEnv } from '../src/config/env.js';
import { credentials } from '../src/config/credentials.js';
import { initDatabase, closeDatabase } from '../src/database/index.js';
import { LgcyClient } from '../src/services/client.js';
import { MODULES } from '../src/modules/index.js';
import { getGuildConfig, isFeatureEnabled } from '../src/config/guildConfig.js';
import { REQUIRED_PERMISSIONS } from '../src/config/requiredPermissions.js';

/* eslint-disable no-console */
const line = (s = '') => console.log(s);
const ok = (s: string) => console.log(`  ✅ ${s}`);
const warn = (s: string) => console.log(`  ⚠️  ${s}`);
const bad = (s: string) => console.log(`  ❌ ${s}`);

async function main(): Promise<void> {
  const env = loadEnv();

  line('════════ LGCY CORE — FIRST-LOGIN DIAGNOSTIC ════════');
  line('(read-only: no commands deployed, nothing posted or modified)\n');

  // Database validation (local; additive migrations only).
  line('Database');
  initDatabase();
  ok(`connected & migrations applied (${env.DATABASE_PATH})`);
  line('');

  const client = new LgcyClient();
  let problems = 0;

  client.once(Events.ClientReady, async () => {
    try {
      const me = client.user!;
      line('Identity');
      ok(`logged in as ${me.tag} (${me.id})`);
      line('');

      line('Intents enabled');
      for (const n of new IntentsBitField(client.options.intents).toArray()) ok(n);
      line('');

      const guildId = credentials.getGuildId();
      const guild = guildId ? await client.guilds.fetch(guildId).catch(() => null) : null;
      if (!guild) {
        bad(`bot is not in guild ${guildId ?? '(no Guild ID configured)'} (invite it first)`);
        problems++;
        return;
      }
      const full = await guild.fetch();
      const meMember = await full.members.fetchMe();
      line('Guild');
      ok(`${full.name} (${full.id}) — ${full.memberCount} members`);
      line('');

      // Permissions audit vs. the minimum required set.
      line('Permissions');
      const missing = REQUIRED_PERMISSIONS.filter((r) => !meMember.permissions.has(r.flag));
      if (meMember.permissions.has('Administrator')) {
        warn('bot has ADMINISTRATOR — not required; consider re-inviting with the minimal integer');
      }
      if (missing.length === 0) ok('all required permissions present');
      else {
        for (const m of missing) bad(`missing: ${m.name} (${m.why})`);
        problems += missing.length;
      }
      line('');

      // Hierarchy.
      line('Role hierarchy');
      const botPos = meMember.roles.highest.position;
      ok(`bot top role "${meMember.roles.highest.name}" at position ${botPos}`);
      if (full.ownerId === me.id) warn('bot owns the guild (unexpected)');

      const cfg = getGuildConfig(full.id);
      const selfRoleIds = cfg.selfRoleGroups.flatMap((g) => g.roles.map((r) => r.roleId));
      if (selfRoleIds.length === 0) {
        warn('no self-roles configured yet — hierarchy for self-roles will be validated after Step 6 mapping');
      } else {
        for (const id of selfRoleIds) {
          const role = full.roles.cache.get(id);
          if (!role) { warn(`configured self-role ${id} not found`); continue; }
          if (role.position >= botPos) { bad(`self-role "${role.name}" is ABOVE the bot — move the bot role higher`); problems++; }
          else ok(`can manage self-role "${role.name}"`);
        }
      }
      // Report roles the bot must stay BELOW (owner/admin/staff) for awareness.
      const above = full.roles.cache.filter((r) => r.position > botPos && r.id !== full.id);
      if (above.size) line(`  ℹ️  ${above.size} role(s) above the bot (owner/admin/staff should be here): ${[...above.values()].slice(0, 8).map((r) => r.name).join(', ')}${above.size > 8 ? '…' : ''}`);
      line('');

      // Modules.
      line('Modules');
      for (const m of MODULES) {
        const enabled = isFeatureEnabled(full.id, m.name, m.defaultEnabled);
        line(`  ${enabled ? '🟢' : '⚪'} ${m.name}`);
      }
      line('');

      // Config readiness (all expected empty on first login).
      line('Configuration readiness (expected: not configured yet)');
      const checks: [string, boolean][] = [
        ['welcome channel', !!cfg.welcomeChannelId],
        ['rules channel', !!cfg.rulesChannelId],
        ['roles channel', !!cfg.rolesChannelId],
        ['ticket parent category', !!cfg.ticketParentCategoryId],
        ['ticket staff roles', cfg.ticketStaffRoleIds.length > 0],
        ['any log channel', Object.keys(cfg.logChannels).length > 0],
      ];
      for (const [name, set] of checks) line(`  ${set ? '🟢 set' : '⚪ not set'} — ${name}`);
      line('');

      line(problems === 0 ? '✅ DIAGNOSTIC PASSED — safe to proceed to Step 5 (deploy commands).' : `❌ ${problems} problem(s) found — resolve before proceeding.`);
    } catch (err) {
      bad(`diagnostic error: ${(err as Error).message}`);
      problems++;
    } finally {
      await client.destroy();
      closeDatabase();
      process.exit(problems === 0 ? 0 : 1);
    }
  });

  const token = credentials.getToken();
  if (!token) {
    bad('No bot token configured. Add it in the Control Center (npm run control) or DISCORD_TOKEN in .env.');
    closeDatabase();
    process.exit(1);
  }
  await client.login(token).catch((err) => {
    bad(`login failed: ${(err as Error).message}`);
    if (String(err).includes('disallowed intents')) {
      bad('→ enable the SERVER MEMBERS and MESSAGE CONTENT privileged intents in the Developer Portal.');
    }
    process.exit(1);
  });
}

main();
/* eslint-enable no-console */
