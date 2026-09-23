/**
 * Renders the upgraded member/message/server log embeds to an HTML mockup styled
 * like Discord, for review before deploy. Read-only, no Discord, no network.
 * Run:  npm run preview:logs   →  preview/logs.html
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { EmbedBuilder } from 'discord.js';
import { LOG_COLORS, tBoth, tDate, actorSuffix, byLine } from '../src/modules/logging/shared.js';

/* eslint-disable no-console */
const now = Math.floor(Date.now() / 1000);
const mod = { id: '200000000000000001', tag: 'GhostAdmin' };

type Item = { label: string; e: EmbedBuilder; footer?: string };
const items: Item[] = [
  { label: 'MEMBER JOIN', footer: 'User 410000000000000009',
    e: new EmbedBuilder().setColor(LOG_COLORS.create).setAuthor({ name: 'noob.07 joined' })
      .setDescription('⚠️ **New account** — created recently, worth a look.')
      .addFields({ name: 'User', value: '@noob.07', inline: true }, { name: 'Account created', value: tDate(now - 3 * 86400), inline: true }, { name: 'Member #', value: '33', inline: true }) },
  { label: 'MEMBER LEAVE', footer: 'User 410000000000000009',
    e: new EmbedBuilder().setColor(LOG_COLORS.delete).setAuthor({ name: 'noob.07 left' })
      .addFields({ name: 'User', value: '@noob.07', inline: true }, { name: 'Members', value: '32', inline: true }, { name: 'Joined server', value: tDate(now - 40 * 86400), inline: false }, { name: 'Roles', value: '@Member @Gamer' }) },
  { label: 'KICK', footer: 'User 410000000000000009 • Mod 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.mod).setAuthor({ name: 'noob.07 was kicked' })
      .setDescription(`**noob.07** was kicked ${actorSuffix({ ...mod, reason: 'spamming' })}`)
      .addFields({ name: 'User', value: '@noob.07', inline: true }, { name: 'Members', value: '32', inline: true }) },
  { label: 'BAN', footer: 'User 410000000000000009 • Mod 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.delete).setAuthor({ name: 'raider99 was banned' })
      .setDescription(`**raider99** was banned ${actorSuffix({ ...mod, reason: 'raid / advertising' })}`)
      .addFields({ name: 'User', value: '@raider99 (410000000000000123)' }) },
  { label: 'TIMEOUT', footer: 'User 410000000000000009 • Mod 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.mod).setAuthor({ name: 'loudmic was timed out' })
      .setDescription(`**loudmic** was timed out ${actorSuffix({ ...mod, reason: 'mic spam' })}`)
      .addFields({ name: 'Until', value: tBoth(now + 3600), inline: true }) },
  { label: 'NICKNAME', footer: 'User 350000000000000007 • Mod 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.update).setAuthor({ name: 'h_a_m_z_a.07 — nickname changed' })
      .setDescription(`Changed ${actorSuffix(mod)}`)
      .addFields({ name: 'Before', value: 'Hamza', inline: true }, { name: 'After', value: 'GHOST', inline: true }) },
  { label: 'ROLES UPDATED', footer: 'User 350000000000000007 • Mod 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.update).setAuthor({ name: 'h_a_m_z_a.07 — roles updated' })
      .setDescription(`Updated ${actorSuffix(mod)}`)
      .addFields({ name: '➕ Added', value: '@VIP' }, { name: '➖ Removed', value: '@Member' }) },
  { label: 'MESSAGE DELETED', footer: 'Author 350000000000000007 • Msg 900... • Mod 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.delete).setAuthor({ name: 'Message deleted in #general' })
      .setDescription(`Deleted ${actorSuffix(mod)}`)
      .addFields({ name: 'Author', value: '@h_a_m_z_a.07', inline: true }, { name: 'Channel', value: '#general', inline: true }, { name: 'Content', value: 'check this out lol' }) },
  { label: 'MESSAGE EDITED', footer: 'Author 350000000000000007 • Msg 900...',
    e: new EmbedBuilder().setColor(LOG_COLORS.update).setAuthor({ name: 'h_a_m_z_a.07 edited a message' })
      .addFields({ name: 'Author', value: '@h_a_m_z_a.07', inline: true }, { name: 'Channel', value: '#general', inline: true }, { name: 'Before', value: 'helo world' }, { name: 'After', value: 'hello world' }) },
  { label: 'BULK DELETE', footer: 'Channel 1534... • Mod 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.delete).setAuthor({ name: 'Bulk message delete in #general' })
      .setDescription(`Purged ${actorSuffix(mod)}`)
      .addFields({ name: 'Channel', value: '#general', inline: true }, { name: 'Messages deleted', value: '42', inline: true }) },
  { label: 'CHANNEL CREATED', footer: 'Channel 1534... • By 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.create).setAuthor({ name: 'Channel created' })
      .setDescription(`#new-lounge (\`new-lounge\`) created ${byLine(mod)}`).addFields({ name: 'Type', value: 'Text', inline: true }) },
  { label: 'CHANNEL UPDATED', footer: 'Channel 1534... • By 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.update).setAuthor({ name: 'Channel updated' })
      .setDescription(`#general updated ${byLine(mod)}\n**Name:** \`general\` → \`general-chat\``) },
  { label: 'ROLE DELETED', footer: 'Role 1534... • By 200000000000000001',
    e: new EmbedBuilder().setColor(LOG_COLORS.delete).setAuthor({ name: 'Role deleted' })
      .setDescription(`\`Temp Event\` deleted ${byLine(mod)}`) },
];

// ── HTML mockup ─────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const bold = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:#fff">$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
const tstamp = (s: string) => s.replace(/<t:(\d+):([a-zA-Z])>/g, (_m: string, sec: string, style: string) => {
  const secN = Number(sec); const dt = new Date(secN * 1000);
  if (style === 'R') { const a = Math.abs(now - secN); return a < 60 ? 'just now' : a < 3600 ? `${Math.round(a / 60)} minutes ago` : a < 86400 ? `${Math.round(a / 3600)} hours ago` : `${Math.round(a / 86400)} days ago`; }
  if (style === 'f') return dt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
});
const hex = (n?: number) => '#' + (n ?? 0x5865f2).toString(16).padStart(6, '0');
const initial = (s: string) => esc((s[0] ?? '?').toUpperCase());

function fieldHtml(f: { name: string; value: string; inline?: boolean }): string {
  return `<div class="field${f.inline ? ' inline' : ''}"><div class="fname">${tstamp(bold(f.name))}</div><div class="fval">${tstamp(bold(f.value)).replace(/\n/g, '<br>')}</div></div>`;
}
function itemHtml(it: Item): string {
  const e = it.e.toJSON();
  const author = e.author ? `<div class="author"><div class="avatar" style="background:${hex(e.color)}">${initial(e.author.name)}</div><span>${esc(e.author.name)}</span></div>` : '';
  const desc = e.description ? `<div class="desc">${tstamp(bold(e.description))}</div>` : '';
  const fields = (e.fields ?? []).map(fieldHtml).join('');
  const footer = it.footer ? `<div class="footer">${esc(it.footer)}</div>` : '';
  return `<div class="row"><div class="tag">${esc(it.label)}</div><div class="embed" style="border-color:${hex(e.color)}">${author}${desc}<div class="fields">${fields}</div>${footer}</div></div>`;
}

const html = `<!doctype html><meta charset="utf-8"><title>LGCY Logs — preview</title>
<style>
 body{background:#313338;color:#dbdee1;font-family:system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:32px}
 h1{color:#fff;font-size:20px;margin:0 0 4px}.sub{color:#949ba4;margin:0 0 24px;font-size:13px}
 .row{display:flex;gap:14px;align-items:flex-start;margin:0 0 16px}
 .tag{flex:0 0 130px;text-align:right;color:#949ba4;font-size:11px;font-weight:700;padding-top:10px}
 .embed{background:#2b2d31;border-left:4px solid;border-radius:4px;padding:12px 16px;max-width:460px;min-width:380px}
 .author{display:flex;align-items:center;gap:8px;margin-bottom:6px}.author span{color:#f2f3f5;font-size:13px;font-weight:600}
 .avatar{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700}
 .desc{color:#dbdee1;font-size:14px;margin-bottom:8px;line-height:1.35}
 .fields{display:flex;flex-wrap:wrap;gap:8px 16px}.field{flex:1 1 100%}.field.inline{flex:1 1 30%;min-width:90px}
 .fname{color:#b5bac1;font-size:12px;font-weight:700;margin-bottom:2px}.fval{color:#dbdee1;font-size:14px;line-height:1.3}
 code{background:#1e1f22;border-radius:3px;padding:0 4px;font-size:13px}
 .footer{color:#949ba4;font-size:11px;margin-top:10px}
</style>
<h1>LGCY Core — Logs preview (member · message · server)</h1>
<p class="sub">Colors: green create/join · red delete/leave/ban · blue update · orange moderator. "by <b>Mod</b>" appears only when the audit log reliably attributes it (needs View Audit Log) — otherwise "by unknown", never a guess. IDs shown in footer (toggle).</p>
${items.map(itemHtml).join('\n')}
`;
mkdirSync(resolve(process.cwd(), 'preview'), { recursive: true });
const out = resolve(process.cwd(), 'preview', 'logs.html');
writeFileSync(out, html);
console.log(`\n✓ logs preview → ${out}\n`);
items.forEach((it) => {
  const e = it.e.toJSON();
  console.log(`── ${it.label} ──  ${e.author?.name ?? ''}`);
  if (e.description) console.log('   ' + tstamp(e.description).replace(/\*\*/g, '').replace(/`/g, ''));
  (e.fields ?? []).forEach((f) => console.log(`   ${f.name}: ${tstamp(f.value).replace(/\n/g, ' | ')}`));
  console.log('');
});
