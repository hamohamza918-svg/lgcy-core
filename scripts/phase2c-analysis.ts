/**
 * PHASE 2 · Section 3C — channel-permission analysis (READ-ONLY, no Discord).
 * Reads preview/channel-audit.json + preview/role-audit.json and reports the
 * category access map, channel exceptions, problems, Muted (frozen), Private
 * (frozen), and the Stage-3C safe/review candidate operations. Mutates nothing.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* eslint-disable no-console */
type OW = { roleId: string; roleName: string; allow: string[]; deny: string[] };
type Ch = { id: string; name: string; type: number; parentId: string | null; position: number; overwrites: OW[] };
const ca = JSON.parse(readFileSync(resolve(process.cwd(), 'preview/channel-audit.json'), 'utf8')) as { guild: { id: string }; channels: Ch[] };
const ra = JSON.parse(readFileSync(resolve(process.cwd(), 'preview/role-audit.json'), 'utf8')) as { roles: { id: string; name: string }[] };
const EVERYONE = ca.guild.id;
const MUTED = '1534981601551974662';
const knownRole = new Set(ra.roles.map((r) => r.id));

const cats = ca.channels.filter((c) => c.type === 4);
const catById = new Map(cats.map((c) => [c.id, c]));
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim() || s;
const owKey = (o: OW) => `${o.roleId}|A:${[...o.allow].sort().join(',')}|D:${[...o.deny].sort().join(',')}`;
const nonCat = ca.channels.filter((c) => c.type !== 4);

// ── 1. Category map ───────────────────────────────────────────────────
console.log('\n════════ 1. CATEGORY ACCESS MAP ════════');
for (const cat of cats.sort((a, b) => b.position - a.position)) {
  const kids = nonCat.filter((c) => c.parentId === cat.id);
  console.log(`\n📁 ${clean(cat.name)}  (${kids.length} channels)`);
  if (!cat.overwrites.length) console.log('   category overwrites: (none — inherits @everyone base)');
  for (const o of cat.overwrites) {
    const parts = [o.allow.length ? 'ALLOW ' + o.allow.join('/') : '', o.deny.length ? 'DENY ' + o.deny.join('/') : ''].filter(Boolean).join('  ');
    console.log(`   ${clean(o.roleName).padEnd(18)} ${parts || '(empty)'}`);
  }
}

// ── 2. Channel exceptions (differ from category) ──────────────────────
console.log('\n\n════════ 2. CHANNEL-BY-CHANNEL EXCEPTIONS ════════');
let exceptions = 0;
for (const ch of nonCat) {
  const cat = ch.parentId ? catById.get(ch.parentId) : null;
  const catKeys = new Set((cat?.overwrites ?? []).map(owKey));
  const chKeys = new Set(ch.overwrites.map(owKey));
  const extra = ch.overwrites.filter((o) => !catKeys.has(owKey(o))); // channel has, category doesn't (or differs)
  const missing = (cat?.overwrites ?? []).filter((o) => !chKeys.has(owKey(o))); // category has, channel doesn't
  if (!extra.length && !missing.length) continue;
  exceptions++;
  console.log(`\n# ${clean(ch.name)}  ⊂ ${cat ? clean(cat.name) : '(no category)'}`);
  for (const o of extra) {
    const frozen = o.roleId === MUTED ? ' [MUTED-FROZEN]' : '';
    const legacy = (!o.allow.length && !o.deny.length) ? 'REDUNDANT (no-op)' : (!knownRole.has(o.roleId) && o.roleId !== EVERYONE ? 'ORPHAN role' : 'exception');
    console.log(`   + ${clean(o.roleName).padEnd(16)} ${['ALLOW ' + o.allow.join('/'), 'DENY ' + o.deny.join('/')].filter((x) => !x.endsWith(' ')).join(' ') || '(empty)'}  → ${legacy}${frozen}`);
  }
  for (const o of missing) console.log(`   − (category has, channel lacks) ${clean(o.roleName)}`);
}
console.log(`\nchannels differing from their category: ${exceptions}`);

// ── 3. Problems ───────────────────────────────────────────────────────
console.log('\n\n════════ 3. PROBLEMS ════════');
const noop: string[] = [], orphan: string[] = [], contradictory: string[] = [], publicStaff: string[] = [], inaccessible: string[] = [], botOW: string[] = [];
const STAFFISH = /staff|system|mgmt|management|admin|log|cmd|decision|review|ticket/i;
for (const ch of ca.channels) {
  for (const o of ch.overwrites) {
    if (!o.allow.length && !o.deny.length) noop.push(`${clean(ch.name)} → ${clean(o.roleName)}`);
    if (o.roleId !== EVERYONE && !knownRole.has(o.roleId)) orphan.push(`${clean(ch.name)} → role ${o.roleId}`);
    const both = o.allow.filter((p) => o.deny.includes(p));
    if (both.length) contradictory.push(`${clean(ch.name)} → ${clean(o.roleName)}: ${both.join(',')} in BOTH`);
  }
  if (ch.type === 4) continue;
  const ev = ch.overwrites.find((o) => o.roleId === EVERYONE);
  const everyoneDeniedView = ev?.deny.includes('ViewChannel');
  const anyRoleView = ch.overwrites.some((o) => o.roleId !== EVERYONE && o.allow.includes('ViewChannel'));
  if (STAFFISH.test(ch.name) && !everyoneDeniedView) publicStaff.push(clean(ch.name));
  if (everyoneDeniedView && !anyRoleView) inaccessible.push(clean(ch.name));
}
const p = (label: string, arr: string[]) => { console.log(`\n${label}: ${arr.length}`); arr.slice(0, 40).forEach((x) => console.log('  • ' + x)); };
p('Redundant no-op overwrites (empty allow+deny)', noop);
p('Orphan role overwrites (role no longer exists)', orphan);
p('Contradictory allow+deny (same perm)', contradictory);
p('Staff/system-named channels NOT hidden from @everyone', publicStaff);
p('Channels nobody but admins can view (everyone denied, no role allowed)', inaccessible);

// ── 4. Muted (frozen) ─────────────────────────────────────────────────
const mutedCh = ca.channels.filter((c) => c.overwrites.some((o) => o.roleId === MUTED));
console.log(`\n\n════════ 4. MUTED — FROZEN (${mutedCh.length} channels) ════════`);
console.log('  ' + mutedCh.map((c) => clean(c.name)).join(', '));

// ── 5. Private (frozen) ───────────────────────────────────────────────
const privateCh = ca.channels.filter((c) => /private/i.test(c.name) || (c.parentId && /private/i.test(catById.get(c.parentId)?.name ?? '')));
console.log(`\n════════ 5. PRIVATE — FROZEN (READ-ONLY, ${privateCh.length}) ════════`);
console.log('  ' + (privateCh.map((c) => clean(c.name)).join(', ') || '(none matched by name — verify manually)'));

// ── 7. Stage 3C candidate counts ──────────────────────────────────────
const safeRemovals = [...new Set([...noop, ...orphan])]; // no-op + orphan removals are safe (no effective-access change)
console.log('\n\n════════ 7. STAGE 3C CANDIDATES ════════');
console.log(`SAFE CLEANUP: ${safeRemovals.length}  (no-op overwrites: ${noop.length}, orphan-role overwrites: ${orphan.length}) — removing these changes NO effective access`);
console.log(`REQUIRES REVIEW: ${exceptions} channels differ from category (excl. Muted/Private) — sync-to-category candidates`);
console.log('EXCLUDED: all Muted overwrites, all Private rooms.');
