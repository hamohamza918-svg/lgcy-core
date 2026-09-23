/**
 * READ-ONLY channel-permission capture. Reads every channel/category and its
 * permission overwrites (role + @everyone: allow/deny) so the Phase-2 channel
 * diff (3C) can be computed. No writes of any kind. Run: npm run audit:channels
 */
import { Client, GatewayIntentBits, Events, OverwriteType, PermissionsBitField } from 'discord.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';

/* eslint-disable no-console */
initDatabase();
const token = credentials.getToken();
const guildId = credentials.getGuildId();
if (!token || !guildId) { console.error('Missing token or guild id.'); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on('error', (e) => console.error('client error:', e.message));

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    await guild.roles.fetch();
    const roleName = (id: string) => guild.roles.cache.get(id)?.name ?? (id === guild.id ? '@everyone' : id);

    const channels = [...guild.channels.cache.values()].filter(Boolean).map((c) => ({
      id: c!.id, name: c!.name, type: c!.type, parentId: 'parentId' in c! ? (c!.parentId ?? null) : null,
      position: 'position' in c! ? c!.position : 0,
      overwrites: 'permissionOverwrites' in c!
        ? [...c!.permissionOverwrites.cache.values()].filter((o) => o.type === OverwriteType.Role).map((o) => ({
            roleId: o.id, roleName: roleName(o.id),
            allow: new PermissionsBitField(o.allow.bitfield).toArray(),
            deny: new PermissionsBitField(o.deny.bitfield).toArray(),
          }))
        : [],
    }));

    mkdirSync(resolve(process.cwd(), 'preview'), { recursive: true });
    const out = resolve(process.cwd(), 'preview', 'channel-audit.json');
    writeFileSync(out, JSON.stringify({ guild: { id: guild.id, name: guild.name }, channelCount: channels.length, channels }, null, 2));
    const overwriteTotal = channels.reduce((n, c) => n + c.overwrites.length, 0);
    console.log(`\n✅ Captured ${channels.length} channels, ${overwriteTotal} role overwrites → ${out}\nNothing was changed.\n`);
  } catch (e) {
    console.error('channel audit failed:', (e as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => { console.error('login failed:', (e as Error).message); process.exit(1); });
