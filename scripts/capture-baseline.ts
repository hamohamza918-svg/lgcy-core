/**
 * READ-ONLY baseline capture. Connects with Guilds + GuildMembers intents, reads
 * every role in the checkpoint format (member IDs, positions, permissions), and
 * writes a snapshot file under data/snapshots/. NOTHING is written to Discord and
 * the mutation lock is NOT required (no edits happen). It does NOT set the
 * checkpoint — accepting a snapshot as the baseline is a separate, deliberate step.
 *
 * Used after a MANUAL hierarchy change (e.g. the server owner drags a managed bot
 * role) so we can verify the new live state and promote it to a fresh baseline.
 *
 * Run:  npm run capture:baseline
 */
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { resolve } from 'node:path';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';
import { applyEngineService } from '../control-center/server/services/applyEngineService.js';
import type { RoleData } from '../control-center/server/services/roleManagerService.js';

/* eslint-disable no-console */
initDatabase();
const token = credentials.getToken();
const guildId = credentials.getGuildId();
if (!token || !guildId) { console.error('Missing bot token or Guild ID. Configure them first.'); process.exit(1); }

function liveRoleData(guild: import('discord.js').Guild): RoleData[] {
  return [...guild.roles.cache.values()].map((r) => ({
    name: r.name, id: r.id, position: r.position, color: r.hexColor, hoist: r.hoist,
    mentionable: r.mentionable, managed: r.managed, administrator: r.permissions.has('Administrator'),
    memberCount: r.members.size, members: [...r.members.values()].map((m) => m.user.id).sort(),
    permissions: r.permissions.toArray().sort(), channelDependencies: [],
    isEveryone: r.id === guild.id, botCanManage: !r.managed && r.id !== guild.id,
  }));
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.on('error', (e) => console.error('client error:', e.message));

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.roles.fetch();
    await guild.members.fetch(); // requires the Server Members intent
    const me = await guild.members.fetchMe();
    const botTop = me.roles.highest.position;
    const stamp = new Date().toISOString();
    const roles = liveRoleData(guild);
    const path = applyEngineService.snapshot(roles, stamp + '-capture');
    console.log(`\n📸 READ-ONLY capture (nothing modified): ${path}`);
    console.log(`   roles: ${roles.filter((r) => !r.isEveryone).length} (+ @everyone) · bot top position: ${botTop}`);

    const LGCY = '1551612525336858747';
    const lg = roles.find((r) => r.id === LGCY);
    console.log('\nTop of hierarchy:');
    roles.filter((r) => r.position >= (lg ? lg.position - 2 : 34)).sort((a, b) => b.position - a.position)
      .forEach((r) => console.log(`  pos ${String(r.position).padStart(2)}  ${r.managed ? '[managed] ' : '          '}${r.name}`));
    if (lg) console.log(`\nLGCY Core → position ${lg.position} (managed=${lg.managed}, botCanManage=${lg.botCanManage})`);
    console.log('\nNext: share this file — do NOT accept it as the checkpoint until the placement is verified.\n');
  } catch (e) {
    console.error('capture failed:', (e as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => {
  console.error('login failed:', (e as Error).message);
  if (String(e).includes('disallowed intents')) console.error('→ enable the Server Members intent in the Developer Portal.');
  process.exit(1);
});
