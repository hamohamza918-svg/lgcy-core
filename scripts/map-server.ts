/**
 * LGCY CORE — server mapper (Step 6).
 *
 * Reads the LIVE guild (channels, categories, roles) and proposes a config
 * mapping by name-matching against EXISTING objects. It writes ONLY a local
 * review file (preview/proposed-config.json) — it never creates anything and
 * never writes to the guild config. Review + approve, then apply via the slash
 * commands (or the follow-up apply step).
 *
 * Run (after .env + invite): `npm run map:server`.
 */
import { ChannelType, Events } from 'discord.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';
import { LgcyClient } from '../src/services/client.js';

/* eslint-disable no-console */
const GAME_ROLES = ['FiveM', 'Minecraft', 'ARK', 'FIFA', 'Overwatch'];
const STAFF_HINTS = /owner|co[-\s]?owner|admin|moderator|\bmod\b|manager|staff|support|developer|\bdev\b|security/i;

function pick<T extends { name: string; id: string }>(items: T[], test: (n: string) => boolean): T | undefined {
  return items.find((i) => test(i.name.toLowerCase()));
}

async function main(): Promise<void> {
  initDatabase();
  const guildId = credentials.getGuildId();
  const client = new LgcyClient();

  client.once(Events.ClientReady, async () => {
    const guild = guildId ? await client.guilds.fetch(guildId).then((g) => g.fetch()).catch(() => null) : null;
    if (!guild) {
      console.log(`❌ Bot is not in guild ${guildId ?? '(no Guild ID configured)'}.`);
      await client.destroy();
      process.exit(1);
    }
    await guild.channels.fetch();
    await guild.roles.fetch();

    const text = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText).map((c) => ({ id: c.id, name: c.name }));
    const cats = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory).map((c) => ({ id: c.id, name: c.name }));
    const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).map((r) => ({ id: r.id, name: r.name, position: r.position, managed: r.managed }));

    const proposed = {
      guild: { id: guild.id, name: guild.name },
      channels: {
        welcomeChannelId: pick(text, (n) => n.includes('welcome') || n.includes('join'))?.id,
        rulesChannelId: pick(text, (n) => n.includes('rule'))?.id,
        rolesChannelId: pick(text, (n) => n.includes('role'))?.id,
        ticketPanelChannelId: pick(text, (n) => n.includes('ticket') || n.includes('support') || n.includes('help'))?.id,
      },
      categories: {
        ticketParentCategoryId: pick(cats, (n) => n.includes('ticket') || n.includes('support'))?.id,
        ticketArchiveCategoryId: pick(cats, (n) => n.includes('archive') || n.includes('closed'))?.id,
      },
      logChannels: {
        member: pick(text, (n) => n.includes('join') || n.includes('member') || n.includes('welcome-log'))?.id,
        message: pick(text, (n) => n.includes('message-log') || n.includes('msg-log'))?.id,
        role: pick(text, (n) => n.includes('role-log'))?.id,
        moderation: pick(text, (n) => n.includes('mod-log') || n.includes('modlog') || n.includes('moderation'))?.id,
        voice: pick(text, (n) => n.includes('voice-log'))?.id,
        server: pick(text, (n) => n.includes('server-log') || n.includes('audit'))?.id,
        ticketLog: pick(text, (n) => n.includes('ticket-log'))?.id,
      },
      selfRoles: Object.fromEntries(
        GAME_ROLES.map((g) => [g, pick(roles, (n) => n.includes(g.toLowerCase()))?.id ?? null]),
      ),
      suggestedStaffRoles: roles.filter((r) => STAFF_HINTS.test(r.name)).map((r) => ({ id: r.id, name: r.name })),
    };

    // Print a readable summary.
    console.log(`\n════════ PROPOSED CONFIG MAPPING — ${guild.name} ════════`);
    console.log('(nothing written — review & approve before applying)\n');
    console.log('START / COMMUNITY channels:');
    for (const [k, v] of Object.entries(proposed.channels)) console.log(`  ${k.padEnd(22)} ${v ? `#${text.find((t) => t.id === v)?.name} (${v})` : '⚠️  no match — choose manually'}`);
    console.log('\nSUPPORT categories:');
    for (const [k, v] of Object.entries(proposed.categories)) console.log(`  ${k.padEnd(24)} ${v ? `${cats.find((c) => c.id === v)?.name} (${v})` : '⚠️  no match'}`);
    console.log('\nLOG destinations:');
    for (const [k, v] of Object.entries(proposed.logChannels)) console.log(`  ${k.padEnd(12)} ${v ? `#${text.find((t) => t.id === v)?.name}` : '⚪ unset'}`);
    console.log('\nGAME self-roles (existing IDs only):');
    for (const [g, id] of Object.entries(proposed.selfRoles)) console.log(`  ${g.padEnd(11)} ${id ? `${roles.find((r) => r.id === id)?.name} (${id})` : '⚠️  not found — create/rename in Discord or map manually'}`);
    console.log('\nSuggested STAFF roles (verify — these gate tickets/moderation):');
    for (const r of proposed.suggestedStaffRoles) console.log(`  • ${r.name} (${r.id})`);

    mkdirSync(resolve(process.cwd(), 'preview'), { recursive: true });
    const out = resolve(process.cwd(), 'preview', 'proposed-config.json');
    writeFileSync(out, JSON.stringify(proposed, null, 2));
    console.log(`\nFull proposal written to: ${out}`);
    console.log('→ Review it, tell me any corrections, and approve before we apply anything.');

    await client.destroy();
    process.exit(0);
  });

  const token = credentials.getToken();
  if (!token) {
    console.log('❌ No bot token configured (set it in the Control Center).');
    process.exit(1);
  }
  await client.login(token).catch((err) => {
    console.log(`❌ login failed: ${(err as Error).message}`);
    process.exit(1);
  });
}

main();
/* eslint-enable no-console */
