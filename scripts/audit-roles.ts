/**
 * READ-ONLY role audit. Connects with Guilds + GuildMembers intents, reads every
 * role's full details (no writes of any kind), and writes preview/role-audit.json
 * plus a console summary. Nothing is modified on Discord.
 *
 * Run:  npm run audit:roles
 */
import { Client, GatewayIntentBits, Events, OverwriteType } from 'discord.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';

/* eslint-disable no-console */
initDatabase();
const token = credentials.getToken();
const guildId = credentials.getGuildId();
if (!token || !guildId) {
  console.error('Missing bot token or Guild ID. Configure them first.');
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
client.on('error', (e) => console.error('client error:', e.message));

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.roles.fetch();
    await guild.channels.fetch();
    await guild.members.fetch(); // requires the Server Members intent
    const me = await guild.members.fetchMe();
    const botPos = me.roles.highest.position;

    // Map role -> channels where it has an explicit permission overwrite.
    const chanDeps = new Map<string, string[]>();
    for (const ch of guild.channels.cache.values()) {
      if (!ch || !('permissionOverwrites' in ch)) continue;
      for (const ow of ch.permissionOverwrites.cache.values()) {
        if (ow.type === OverwriteType.Role) {
          const arr = chanDeps.get(ow.id) ?? [];
          arr.push(ch.name);
          chanDeps.set(ow.id, arr);
        }
      }
    }

    const roles = [...guild.roles.cache.values()]
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        name: r.name,
        id: r.id,
        position: r.position,
        color: r.hexColor,
        hoist: r.hoist,
        mentionable: r.mentionable,
        managed: r.managed,
        administrator: r.permissions.has('Administrator'),
        memberCount: r.members.size,
        members: [...r.members.values()].map((m) => m.user.username).slice(0, 60),
        permissions: r.permissions.toArray(),
        channelDependencies: chanDeps.get(r.id) ?? [],
        isEveryone: r.id === guild.id,
        botCanManage: !r.managed && r.id !== guild.id && r.position < botPos,
      }));

    const out = {
      guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount },
      botTopPosition: botPos,
      roleCount: roles.length,
      generatedAtNote: 'read-only snapshot; nothing was modified',
      roles,
    };

    mkdirSync(resolve(process.cwd(), 'preview'), { recursive: true });
    writeFileSync(resolve(process.cwd(), 'preview', 'role-audit.json'), JSON.stringify(out, null, 2));

    console.log(`\nAudited ${roles.length} roles in "${guild.name}" (bot top position ${botPos}) → preview/role-audit.json\n`);
    console.log('pos | role name                      | mem | flags');
    console.log('----+--------------------------------+-----+---------------------------');
    for (const r of roles) {
      const flags = [
        r.administrator ? 'ADMIN' : '',
        r.managed ? 'managed' : '',
        r.hoist ? 'hoist' : '',
        r.botCanManage ? 'manageable' : (r.isEveryone ? 'everyone' : 'above-bot'),
      ].filter(Boolean).join(',');
      console.log(`${String(r.position).padStart(3)} | ${r.name.slice(0, 30).padEnd(30)} | ${String(r.memberCount).padStart(3)} | ${flags}`);
    }
    console.log('\n✅ Done. Nothing was changed. Share preview/role-audit.json for the full audit.\n');
  } catch (e) {
    console.error('audit failed:', (e as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => {
  console.error('login failed:', (e as Error).message);
  if (String(e).includes('disallowed intents')) {
    console.error('→ enable the Server Members intent in the Developer Portal.');
  }
  process.exit(1);
});
