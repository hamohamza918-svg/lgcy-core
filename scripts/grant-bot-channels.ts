/**
 * Grants the LGCY Core bot role the ability to POST in the channels where it is
 * currently blocked (View / Send / Embed / Attach). Adds/merges ONLY a single
 * overwrite for the bot's own role — every other overwrite (@everyone, Muted,
 * staff roles) is left exactly as-is. Idempotent: skips channels the bot can
 * already fully post in. NEVER touches any channel whose name or category
 * contains "private" (hard rule).
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
    const me = await guild.members.fetchMe();
    const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim() || s;
    const isPrivate = (ch: import('discord.js').GuildChannel) => {
      const parent = ch.parent?.name ?? '';
      return /private/i.test(ch.name) || /private/i.test(parent);
    };

    for (const ch of guild.channels.cache.values()) {
      if (!ch || !TEXTLIKE.has(ch.type)) continue;
      const gch = ch as import('discord.js').GuildChannel;
      if (isPrivate(gch)) { results.push({ name: clean(ch.name), status: 'skipped', detail: 'PRIVATE — untouched' }); continue; }

      const before = ch.permissionsFor(me);
      const missing = POST.filter(([, f]) => !before?.has(f)).map(([n]) => n);
      if (!missing.length) { results.push({ name: clean(ch.name), status: 'already-ok' }); continue; }

      try {
        await withRetry(() => gch.permissionOverwrites.edit(LGCY_ROLE_ID, {
          ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true,
        }), `edit ${ch.id}`);
        const fresh = await withRetry(() => guild.channels.fetch(ch.id, { force: true }), `verify ${ch.id}`);
        const after = fresh && 'permissionsFor' in fresh ? fresh.permissionsFor(me) : null;
        const stillMissing = POST.filter(([, f]) => !after?.has(f)).map(([n]) => n);
        if (stillMissing.length) { results.push({ name: clean(ch.name), status: 'FAILED', detail: 'still missing ' + stillMissing.join(', ') }); console.error(`  ❌ ${clean(ch.name)} still missing ${stillMissing.join(', ')}`); }
        else { results.push({ name: clean(ch.name), status: 'granted', detail: '+' + missing.join(', ') }); console.log(`  ✓ ${clean(ch.name).padEnd(30)} granted (was missing ${missing.join(', ')})`); }
      } catch (err) {
        results.push({ name: clean(ch.name), status: 'FAILED', detail: (err as Error).message });
        console.error(`  ❌ ${clean(ch.name)}: ${(err as Error).message}`);
      }
    }

    const g = results.filter((r) => r.status === 'granted').length;
    const ok = results.filter((r) => r.status === 'already-ok').length;
    const sk = results.filter((r) => r.status === 'skipped').length;
    const f = results.filter((r) => r.status === 'FAILED').length;
    console.log(`\n──── RESULT ────\n  granted: ${g} · already-ok: ${ok} · skipped(private): ${sk} · failed: ${f}\n`);
    results.filter((r) => r.status === 'skipped').forEach((r) => console.log(`  ⏭ ${r.name} — ${r.detail}`));
  } catch (err) {
    console.error('grant failed:', (err as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => { console.error('login failed:', (e as Error).message); process.exit(1); });
