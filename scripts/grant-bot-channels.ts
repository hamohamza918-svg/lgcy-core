/**
 * Ensures the LGCY Core bot role has an explicit POST overwrite (View / Send /
 * Embed / Attach) on every non-private text/announcement channel. Adds/merges
 * ONLY the bot's own overwrite — every other overwrite (@everyone, Muted, staff
 * roles) is left exactly as-is. NEVER touches a channel whose name or category
 * contains "private".
 *
 * Checks the actual OVERWRITE bits (not effective permissions), so it works
 * correctly even while the bot temporarily has Administrator — that's how we
 * bootstrap access to private staff/log channels the bot otherwise can't see.
 * Idempotent: skips channels whose bot overwrite already allows all four.
 *
 * Gated by the mutation lock — set LGCY_ALLOW_MUTATIONS=1 for a single run.
 *
 * Run:  $env:LGCY_ALLOW_MUTATIONS='1'; npm run bot:grant-channels; Remove-Item Env:LGCY_ALLOW_MUTATIONS
 */
import { Client, GatewayIntentBits, Events, ChannelType, PermissionFlagsBits } from 'discord.js';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';
import { liveLock } from '../control-center/server/services/liveLock.js';

/* eslint-disable no-console */
initDatabase();
try {
  liveLock.assert('Grant bot channel access');
} catch (e) {
  console.error(`\n🔒 ${(e as Error).message}\nSet LGCY_ALLOW_MUTATIONS=1 for a single run to apply.\n`);
  process.exit(1);
}

const token = credentials.getToken();
const guildId = credentials.getGuildId();
if (!token || !guildId) { console.error('Missing token or guild id.'); process.exit(1); }

const LGCY_ROLE_ID = '1551612525336858747';
const POST: [string, bigint][] = [
  ['View', PermissionFlagsBits.ViewChannel],
  ['Send', PermissionFlagsBits.SendMessages],
  ['Embed', PermissionFlagsBits.EmbedLinks],
  ['Attach', PermissionFlagsBits.AttachFiles],
];
const TEXTLIKE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 4): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      const err = e as { retryAfter?: number; retry_after?: number; status?: number; message?: string };
      let ra = err.retryAfter ?? err.retry_after ?? null;
      if (ra == null && err.message) { const m = /retry after ([0-9.]+)/i.exec(err.message); if (m) ra = Number(m[1]); }
      if (ra == null && err.status === 429) ra = 5;
      if (ra == null || i === tries - 1) throw e;
      const wait = Math.ceil(ra * 1000) + 750;
      console.log(`  ⏳ rate limited on ${label} — waiting ${(wait / 1000).toFixed(1)}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on('error', (e) => console.error('client error:', e.message));

client.once(Events.ClientReady, async () => {
  const results: { name: string; status: string; detail?: string }[] = [];
  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim() || s;
    const isPrivate = (ch: import('discord.js').GuildChannel) =>
      /private/i.test(ch.name) || /private/i.test(ch.parent?.name ?? '');
    const owAllowsAll = (ch: import('discord.js').GuildChannel) => {
      const ow = ch.permissionOverwrites.cache.get(LGCY_ROLE_ID);
      return !!ow && POST.every(([, f]) => ow.allow.has(f));
    };

    for (const ch of guild.channels.cache.values()) {
      if (!ch || !TEXTLIKE.has(ch.type)) continue;
      const gch = ch as import('discord.js').GuildChannel;
      const name = clean(ch.name);
      if (isPrivate(gch)) { results.push({ name, status: 'skipped', detail: 'PRIVATE — untouched' }); continue; }
      if (owAllowsAll(gch)) { results.push({ name, status: 'already-ok' }); continue; }

      try {
        await withRetry(() => gch.permissionOverwrites.edit(LGCY_ROLE_ID, {
          ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true,
        }), `edit ${ch.id}`);
        const fresh = await withRetry(() => guild.channels.fetch(ch.id, { force: true }), `verify ${ch.id}`);
        const ok = fresh && 'permissionOverwrites' in fresh && owAllowsAll(fresh as import('discord.js').GuildChannel);
        if (ok) { results.push({ name, status: 'granted' }); console.log(`  ✓ ${name}`); }
        else { results.push({ name, status: 'FAILED', detail: 'overwrite not confirmed' }); console.error(`  ❌ ${name}: overwrite not confirmed`); }
      } catch (err) {
        results.push({ name, status: 'FAILED', detail: (err as Error).message });
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
      }
    }

    const g = results.filter((r) => r.status === 'granted').length;
    const ok = results.filter((r) => r.status === 'already-ok').length;
    const sk = results.filter((r) => r.status === 'skipped').length;
    const f = results.filter((r) => r.status === 'FAILED').length;
    console.log(`\n──── RESULT ────\n  granted: ${g} · already-ok: ${ok} · skipped(private): ${sk} · failed: ${f}\n`);
    results.filter((r) => r.status === 'FAILED').forEach((r) => console.log(`  ❌ ${r.name} — ${r.detail}`));
    results.filter((r) => r.status === 'skipped').forEach((r) => console.log(`  ⏭ ${r.name} — ${r.detail}`));
  } catch (err) {
    console.error('grant failed:', (err as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => { console.error('login failed:', (e as Error).message); process.exit(1); });
