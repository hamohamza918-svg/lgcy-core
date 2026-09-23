/**
 * Renders the upgraded voice-log embeds (JOIN / MOVE / LEAVE / MODERATOR / STATE)
 * to an HTML mockup styled like Discord, so they can be reviewed before deploy.
 * Read-only, no Discord, no network.
 *
 * Run:  npm run preview:voice   →  preview/voice-logs.html
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  renderJoinEmbed, renderMoveEmbed, renderSessionSummaryEmbed, renderModEmbed, renderStateEmbed,
} from '../src/modules/logging/voiceLog.js';

/* eslint-disable no-console */
const now = Math.floor(Date.now() / 1000);
const joined = now - 2720; // ~45m ago

const embeds = [
  { label: 'JOIN', json: renderJoinEmbed({
      username: 'h_a_m_z_a.07', channelName: 'LGCY 3', channelId: '1534000000000000003', userId: '350000000000000007',
      countBefore: 2, countAfter: 3, selfMute: false, selfDeaf: false, timestampSec: now, includeIds: true, showCounts: true,
    }).toJSON() },
  { label: 'MOVE', json: renderMoveEmbed({
      username: 'h_a_m_z_a.07', fromName: 'LGCY 3', fromId: '1534000000000000003', toName: 'LGCY 2', toId: '1534000000000000002',
      userId: '350000000000000007', timeInPreviousMs: 74_000, fromBefore: 3, fromAfter: 2, toBefore: 1, toAfter: 2,
      joinedAtSec: now - 74, moveNumber: 2, timestampSec: now, includeIds: true, showCounts: true, showDuration: true,
    }).toJSON() },
  { label: 'LEAVE (session summary)', json: renderSessionSummaryEmbed({
      username: 'h_a_m_z_a.07', channelId: '1534000000000000002', userId: '350000000000000007',
      routeNames: ['LGCY 3', 'LGCY 2', 'LGCY 3'], sessionDurationMs: 2_720_000, moveCount: 2, peakChannelSize: 6,
      joinedAtSec: joined, leftAtSec: now, includeIds: true, showCounts: true, showDuration: true,
    }).toJSON() },
  { label: 'MOD — MOVE', json: renderModEmbed({
      username: 'noobmaster', userId: '410000000000000009', action: 'moved', fromName: 'LGCY 2', fromId: '1534000000000000002',
      toName: 'AFK', toId: '1534000000000000000', moderatorTag: 'GhostAdmin', moderatorId: '200000000000000001',
      reason: 'AFK for 20 min', timestampSec: now, includeIds: true,
    }).toJSON() },
  { label: 'MOD — SERVER MUTE', json: renderModEmbed({
      username: 'loudmic', userId: '420000000000000003', action: 'serverMute', channelName: 'LGCY 3', channelId: '1534000000000000003',
      moderatorTag: 'GhostAdmin', moderatorId: '200000000000000001', reason: 'mic spam', timestampSec: now, includeIds: true,
    }).toJSON() },
  { label: 'STATE CHANGE (debug channel)', json: renderStateEmbed({
      username: 'h_a_m_z_a.07', channelName: 'LGCY 3', channelId: '1534000000000000003', userId: '350000000000000007',
      name: 'Screen Share', emoji: '🖥️', on: true, title: 'Started Screen Share', verb: 'started screen sharing',
      timestampSec: now, includeIds: true,
    }).toJSON() },
];

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
// Render Discord <t:sec:style> tokens as readable text for the mockup (Discord
// itself renders these live: exact time, and "(2 minutes ago)" for :R).
const tstamp = (s: string) =>
  s.replace(/<t:(\d+):([a-zA-Z])>/g, (_m: string, sec: string, style: string) => {
    const secN = Number(sec);
    const dt = new Date(secN * 1000);
    if (style === 'R') {
      const abs = Math.abs(now - secN);
      if (abs < 60) return 'just now';
      if (abs < 3600) return `${Math.round(abs / 60)} minutes ago`;
      if (abs < 86400) return `${Math.round(abs / 3600)} hours ago`;
      return `${Math.round(abs / 86400)} days ago`;
    }
    if (style === 'd' || style === 'D') return dt.toLocaleDateString('en-US');
    return dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  });
const hex = (n?: number) => '#' + (n ?? 0x5865f2).toString(16).padStart(6, '0');
const initial = (name: string) => esc((name[0] ?? '?').toUpperCase());

function fieldHtml(f: { name: string; value: string; inline?: boolean }): string {
  const w = f.inline ? 'field inline' : 'field';
  return `<div class="${w}"><div class="fname">${tstamp(esc(f.name))}</div><div class="fval">${tstamp(esc(f.value)).replace(/\n/g, '<br>')}</div></div>`;
}

const bold = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:#fff">$1</b>');
function embedHtml(label: string, e: { color?: number; author?: { name: string }; title?: string; description?: string; fields?: { name: string; value: string; inline?: boolean }[]; footer?: { text: string } }): string {
  const author = e.author ? `<div class="author"><div class="avatar" style="background:${hex(e.color)}">${initial(e.author.name)}</div><span>${esc(e.author.name)}</span></div>` : '';
  const title = e.title ? `<div class="title">${esc(e.title)}</div>` : '';
  const desc = e.description ? `<div class="desc">${tstamp(bold(e.description))}</div>` : '';
  const fields = (e.fields ?? []).map(fieldHtml).join('');
  const footer = e.footer ? `<div class="footer">${tstamp(esc(e.footer.text))} • today at ${new Date(now * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>` : '';
  return `<div class="row"><div class="tag">${esc(label)}</div><div class="embed" style="border-color:${hex(e.color)}">${author}${title}${desc}<div class="fields">${fields}</div>${footer}</div></div>`;
}

const html = `<!doctype html><meta charset="utf-8"><title>LGCY Voice Logs — preview</title>
<style>
  body{background:#313338;color:#dbdee1;font-family:'gg sans',system-ui,Segoe UI,Arial,sans-serif;margin:0;padding:32px}
  h1{color:#fff;font-size:20px;margin:0 0 4px}
  .sub{color:#949ba4;margin:0 0 24px;font-size:13px}
  .row{display:flex;gap:14px;align-items:flex-start;margin:0 0 18px}
  .tag{flex:0 0 90px;text-align:right;color:#949ba4;font-size:11px;font-weight:700;letter-spacing:.04em;padding-top:10px}
  .embed{background:#2b2d31;border-left:4px solid;border-radius:4px;padding:12px 16px;max-width:440px;min-width:360px}
  .author{display:flex;align-items:center;gap:8px;margin-bottom:6px}
  .author span{color:#f2f3f5;font-size:13px;font-weight:600}
  .avatar{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700}
  .title{color:#fff;font-weight:700;font-size:15px;margin-bottom:6px}
  .desc{color:#dbdee1;font-size:14px;margin-bottom:8px;line-height:1.35}
  .fields{display:flex;flex-wrap:wrap;gap:8px 16px}
  .field{flex:1 1 100%}
  .field.inline{flex:1 1 30%;min-width:90px}
  .fname{color:#b5bac1;font-size:12px;font-weight:700;margin-bottom:2px}
  .fval{color:#dbdee1;font-size:14px;line-height:1.3}
  .footer{color:#949ba4;font-size:11px;margin-top:10px}
</style>
<h1>LGCY Core — Voice Logging preview</h1>
<p class="sub">Colors: JOIN green · MOVE blue · LEAVE purple · MODERATOR orange · STATE blurple. IDs shown here (footer) are OFF by default. Discord timestamps shown as local time.</p>
${embeds.map((x) => embedHtml(x.label, x.json)).join('\n')}
`;

mkdirSync(resolve(process.cwd(), 'preview'), { recursive: true });
const out = resolve(process.cwd(), 'preview', 'voice-logs.html');
writeFileSync(out, html);
console.log(`\n✓ voice-log preview → ${out}\n`);
embeds.forEach((x) => {
  const e = x.json;
  console.log(`── ${x.label} ──  ${e.title ?? ''}`);
  if (e.description) console.log(`   ${tstamp(e.description).replace(/\*\*/g, '')}`);
  (e.fields ?? []).forEach((f) => console.log(`   ${f.name}: ${tstamp(f.value).replace(/\n/g, ' | ')}`));
  if (e.footer) console.log(`   footer: ${tstamp(e.footer.text)}`);
  console.log('');
});
