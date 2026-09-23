/**
 * READ-ONLY: reports the bot's EFFECTIVE posting ability in every text-like
 * channel (View / Send / Embed / Attach). Nothing is modified on Discord.
 * Used to decide which channels need a bot permission override.
 *
 * Run:  npm run bot:post-check
 */
import { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits } from 'discord.js';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';

/* eslint-disable no-console */
initDatabase();
const token = credentials.getToken();
const guildId = credentials.getGuildId();
if (!token || !guildId) { console.error('Missing token or guild id.'); process.exit(1); }

const POST: [string, bigint][] = [
  ['View', PermissionFlagsBits.ViewChannel],
  ['Send', PermissionFlagsBits.SendMessages],
  ['Embed', PermissionFlagsBits.EmbedLinks],
  ['Attach', PermissionFlagsBits.AttachFiles],
];
const TEXTLIKE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on('error', (e) => console.error('client error:', e.message));

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    const me = await guild.members.fetchMe();
    const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim() || s;

    const blocked: { id: string; name: string; missing: string[] }[] = [];
    let okCount = 0;
    for (const ch of guild.channels.cache.values()) {
      if (!ch || !TEXTLIKE.has(ch.type)) continue;
      const perms = ch.permissionsFor(me);
      const missing = POST.filter(([, f]) => !perms?.has(f)).map(([n]) => n);
      if (missing.length) blocked.push({ id: ch.id, name: clean(ch.name), missing });
      else okCount++;
    }

    console.log(`\nBot: ${me.user.tag} · text/announcement channels: ${okCount + blocked.length}`);
    console.log(`✅ can fully post in: ${okCount}`);
    console.log(`❌ blocked (missing a posting perm): ${blocked.length}\n`);
    blocked.sort((a, b) => a.name.localeCompare(b.name)).forEach((b) =>
      console.log(`  ${b.id}  ${b.name.padEnd(32)}  missing: ${b.missing.join(', ')}`));
    console.log('');
  } catch (e) {
    console.error('check failed:', (e as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => { console.error('login failed:', (e as Error).message); process.exit(1); });
