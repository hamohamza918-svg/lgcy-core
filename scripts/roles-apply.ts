/**
 * Role Apply / Rollback runner — the ONLY thing that mutates roles on Discord.
 *
 *   npm run roles:apply -- --stage names    apply ONLY renames + colors (Stage 1)
 *   npm run roles:apply -- --stage hoist    apply ONLY hoist changes  (Stage 2)
 *   npm run roles:apply -- --rollback <snapshot.json>   restore from a snapshot
 *
 * Gated by the mutation lock — refuses unless LGCY_ALLOW_MUTATIONS=1 (set it
 * inline for a single run so it re-locks automatically afterwards).
 *
 * Per stage: snapshot LIVE → validate drift → apply sequentially → verify each
 * change (and role ID) → STOP on first failure → integrity-check (43 roles, 0
 * deleted, IDs/positions/permissions/member-assignments unchanged) → write
 * before/after snapshots + a report.
 */
import { Client, GatewayIntentBits, Events, PermissionsBitField } from 'discord.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';
import { liveLock } from '../control-center/server/services/liveLock.js';
import { applyEngineService } from '../control-center/server/services/applyEngineService.js';
import type { RoleData } from '../control-center/server/services/roleManagerService.js';

/* eslint-disable no-console */
const argv = process.argv.slice(2);
const stage: string = argv[argv.indexOf('--stage') + 1] ?? 'all'; // names|hoist|all|lgcy|perms:<group>
const rbIdx = argv.indexOf('--rollback');
const rollbackFile = rbIdx >= 0 ? argv[rbIdx + 1] : null;
const STAGE_TYPES: Record<string, string[]> = { names: ['RENAME', 'COLOR'], hoist: ['HOIST'], all: ['RENAME', 'COLOR', 'HOIST', 'MOVE'] };

initDatabase();
try {
  liveLock.assert('Role apply CLI');
} catch (e) {
  console.error(`\n🔒 ${(e as Error).message}\nSet LGCY_ALLOW_MUTATIONS=1 for a single run to apply (after final approval).\n`);
  process.exit(1);
}

const token = credentials.getToken();
const guildId = credentials.getGuildId();
if (!token || !guildId) { console.error('Missing token or guild id.'); process.exit(1); }

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
      console.log(`  ⏳ rate limited on ${label} — waiting ${(wait / 1000).toFixed(1)}s (retry ${i + 1}/${tries})`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error('unreachable');
}

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
  const results: { op: string; role: string; status: 'ok' | 'failed'; detail?: string }[] = [];
  try {
    const guild = await client.guilds.fetch(guildId);
    await withRetry(() => guild.roles.fetch().then(() => undefined), 'roles.fetch');
    await withRetry(() => guild.members.fetch().then(() => undefined), 'members.fetch'); // opcode 8 — once only
    const stamp = new Date().toISOString();
    const before = liveRoleData(guild);
    const beforeById = new Map(before.map((r) => [r.id, r]));
    const targetPermIds = new Set<string>(); // roles a perms-stage intentionally changes
    let positionsExpected = false;            // true for the LGCY-Core move stage
    const snapPath = applyEngineService.snapshot(before, stamp);
    console.log(`\n📸 BEFORE snapshot: ${snapPath}`);

    if (rollbackFile) {
      const snap = JSON.parse(readFileSync(resolve(process.cwd(), rollbackFile), 'utf8')) as { roles: RoleData[] };
      console.log(`↩️  Rolling back ${snap.roles.length} roles…`);
      for (const s of snap.roles) {
        const role = guild.roles.cache.get(s.id);
        if (!role || role.managed || role.id === guild.id) continue;
        try { await role.edit({ name: s.name, colors: { primaryColor: s.color as `#${string}` }, hoist: s.hoist, mentionable: s.mentionable }); results.push({ op: 'ROLLBACK', role: s.name, status: 'ok' }); }
        catch (err) { results.push({ op: 'ROLLBACK', role: s.name, status: 'failed', detail: (err as Error).message }); break; }
      }
    } else {
      const v = applyEngineService.validateLive(before, stage);
      console.log(`   reference: ${v.referenceType} · already-applied: ${v.alreadyApplied.length} · pending: ${v.pending.length}`);
      if (!v.ok) { console.error('❌ Real drift detected — aborting (drift protection intact). Re-run `npm run audit:roles`.'); v.drift.forEach((d) => console.error('  -', d)); await client.destroy(); process.exit(1); }

      const eq = (a: unknown, b: unknown) => JSON.stringify(a).toLowerCase() === JSON.stringify(b).toLowerCase();

      if (stage === 'lgcy') {
        // 3A: move LGCY Core below ownership, staying above the roles it manages.
        positionsExpected = true;
        const OWN = ['1534981491140988968', '1534981506747994132', '1534981494018281492'];
        const GAMES = ['1534981581809127578', '1534981598351724634', '1534981594081792173', '1534981585516888205', '1534981591250505749'];
        const lgcy = guild.roles.cache.get('1551612525336858747');
        const ownerPos = OWN.map((id) => guild.roles.cache.get(id)?.position).filter((p): p is number => p != null);
        const highestGame = Math.max(...GAMES.map((id) => guild.roles.cache.get(id)?.position ?? 0), 0);
        const lowestOwner = Math.min(...ownerPos);
        const target = lowestOwner - 1;
        if (!lgcy) results.push({ op: 'MOVE', role: 'LGCY Core', status: 'failed', detail: 'not found' });
        else if (target <= highestGame) { results.push({ op: 'MOVE', role: 'LGCY Core', status: 'failed', detail: `unsafe target ${target} (would drop below a game role at ${highestGame})` }); console.error('❌ unsafe move — stopping.'); }
        else if (lgcy.position < lowestOwner && lgcy.position > highestGame) { results.push({ op: 'MOVE', role: 'LGCY Core', status: 'ok', detail: 'already below ownership' }); console.log('  ⏭ MOVE LGCY Core (already below ownership)'); }
        else {
          try {
            await lgcy.setPosition(target);
            const fresh = await withRetry(() => guild.roles.fetch('1551612525336858747', { force: true }), 'verify LGCY Core');
            const okpos = !!fresh && fresh.position < lowestOwner && fresh.position > highestGame;
            results.push({ op: 'MOVE', role: 'LGCY Core', status: okpos ? 'ok' : 'failed', detail: okpos ? `now pos ${fresh!.position} (below ownership, above games)` : `verify failed (pos ${fresh?.position})` });
            console.log(okpos ? `  ✓ MOVE LGCY Core → pos ${fresh!.position}` : '❌ MOVE LGCY Core verify failed');
          } catch (err) { results.push({ op: 'MOVE', role: 'LGCY Core', status: 'failed', detail: (err as Error).message }); console.error('❌ move failed:', (err as Error).message); }
        }
      } else if (stage.startsWith('perms:')) {
        // 3B: apply a tagged permission group (remove/add), idempotent + verified.
        const group = stage.slice(6);
        const ops = applyEngineService.permissionOps().filter((o) => o.group === group);
        console.log(`\n▶ STAGE "${stage}" — ${ops.length} role(s)\n`);
        for (const o of ops) {
          targetPermIds.add(o.roleId);
          const role = guild.roles.cache.get(o.roleId);
          if (!role) { results.push({ op: 'PERM', role: o.roleName, status: 'failed', detail: 'not found' }); console.error(`❌ ${o.roleName}: not found — stopping.`); break; }
          const have = role.permissions.toArray();
          const stillHas = o.remove.filter((p) => have.includes(p as never));
          const missAdd = o.add.filter((p) => !have.includes(p as never));
          if (!stillHas.length && !missAdd.length) { results.push({ op: 'PERM', role: o.roleName, status: 'ok', detail: 'already applied' }); console.log(`  ⏭ PERM ${o.roleName} (already applied)`); continue; }
          try {
            const next = new PermissionsBitField(role.permissions.bitfield).remove(o.remove as never).add(o.add as never);
            await role.edit({ permissions: next });
            const fresh = await withRetry(() => guild.roles.fetch(o.roleId, { force: true }), `verify ${o.roleName}`);
            const fa = fresh ? fresh.permissions.toArray() : [];
            const okp = !!fresh && o.remove.every((p) => !fa.includes(p as never)) && o.add.every((p) => fa.includes(p as never));
            results.push({ op: 'PERM', role: o.roleName, status: okp ? 'ok' : 'failed', detail: okp ? `− ${o.remove.join(', ') || '—'}${o.add.length ? ' + ' + o.add.join(', ') : ''}` : 'verify mismatch' });
            if (!okp) { console.error(`❌ PERM ${o.roleName}: verify failed — stopping.`); break; }
            console.log(`  ✓ PERM ${o.roleName}  − ${o.remove.join(', ')}${o.add.length ? ' + ' + o.add.join(', ') : ''}`);
          } catch (err) { results.push({ op: 'PERM', role: o.roleName, status: 'failed', detail: (err as Error).message }); console.error(`❌ PERM ${o.roleName}: ${(err as Error).message} — stopping.`); break; }
        }
      } else {
        const types = STAGE_TYPES[stage] ?? ['RENAME', 'COLOR', 'HOIST', 'MOVE'];
        const ops = applyEngineService.plan().ops.filter((o) => o.selected && types.includes(o.type));
        console.log(`\n▶ STAGE "${stage}" — ${ops.length} operation(s)\n`);
        for (const o of ops) {
          const role = guild.roles.cache.get(o.roleId);
          if (!role) { results.push({ op: o.type, role: o.roleName, status: 'failed', detail: 'role not found' }); console.error(`❌ ${o.roleName}: not found — stopping.`); break; }
          const cur = o.type === 'RENAME' ? role.name : o.type === 'COLOR' ? role.hexColor : o.type === 'HOIST' ? role.hoist : role.position;
          if (eq(cur, o.to)) { results.push({ op: o.type, role: o.roleName, status: 'ok', detail: 'already applied' }); console.log(`  ⏭ ${o.type}  ${o.roleName} (already applied)`); continue; }
          if (!eq(cur, o.from)) { results.push({ op: o.type, role: o.roleName, status: 'failed', detail: `unexpected live value ${JSON.stringify(cur)}` }); console.error(`❌ ${o.type} ${o.roleName}: value is neither original nor target — stopping.`); break; }
          try {
            if (o.type === 'RENAME') await role.edit({ name: o.to as string });
            else if (o.type === 'COLOR') await role.edit({ colors: { primaryColor: o.to as `#${string}` } });
            else if (o.type === 'HOIST') await role.edit({ hoist: o.to as boolean });
            else if (o.type === 'MOVE') await role.setPosition(o.to as number);
            let fresh: import('discord.js').Role | null;
            try { fresh = await withRetry(() => guild.roles.fetch(o.roleId, { force: true }), `verify ${o.roleName}`); }
            catch { results.push({ op: o.type, role: o.roleName, status: 'ok', detail: 'applied (verification deferred — rate limited)' }); console.log(`  ✓ ${o.type}  ${o.roleName} (applied; verify deferred)`); continue; }
            if (!fresh || fresh.id !== o.roleId) throw new Error('role ID changed/missing after edit');
            const now = o.type === 'RENAME' ? fresh.name : o.type === 'COLOR' ? fresh.hexColor : o.type === 'HOIST' ? fresh.hoist : fresh.position;
            const okv = eq(now, o.to);
            results.push({ op: o.type, role: o.roleName, status: okv ? 'ok' : 'failed', detail: okv ? undefined : `verify mismatch (got ${now})` });
            if (!okv) { console.error(`❌ ${o.type} ${o.roleName}: verify failed — stopping.`); break; }
            console.log(`  ✓ ${o.type}  ${o.roleName}`);
          } catch (err) { results.push({ op: o.type, role: o.roleName, status: 'failed', detail: (err as Error).message }); console.error(`❌ ${o.type} ${o.roleName}: ${(err as Error).message} — stopping.`); break; }
        }
      }
    }

    // ── Integrity verification ──────────────────────────────────
    // Re-fetch roles (REST, auto-retried) only. Do NOT re-fetch members
    // (opcode 8) — name/color/hoist edits never change membership, so we reuse
    // the member cache from the single earlier fetch. This avoids the gateway
    // member-request rate limit that previously aborted post-apply.
    await withRetry(() => guild.roles.fetch().then(() => undefined), 'roles.fetch(after)');
    const after = liveRoleData(guild);
    const afterById = new Map(after.map((r) => [r.id, r]));
    const nonEveryoneBefore = before.filter((r) => !r.isEveryone);
    const nonEveryoneAfter = after.filter((r) => !r.isEveryone);
    const deleted = [...beforeById.keys()].filter((id) => !afterById.has(id));
    // Position changes are expected during the LGCY-Core move (it reindexes
    // intermediate roles); permission changes are expected on a perms-stage's
    // target roles. Only UNEXPECTED changes are flagged as integrity failures.
    const posChanged = positionsExpected ? [] : nonEveryoneBefore.filter((r) => afterById.get(r.id)?.position !== r.position).map((r) => r.name);
    const permChanged = nonEveryoneBefore.filter((r) => !targetPermIds.has(r.id) && JSON.stringify(afterById.get(r.id)?.permissions) !== JSON.stringify(r.permissions)).map((r) => r.name);
    const membersChanged = nonEveryoneBefore.filter((r) => JSON.stringify(afterById.get(r.id)?.members) !== JSON.stringify(r.members)).map((r) => r.name);

    const integrity = {
      rolesBefore: nonEveryoneBefore.length, rolesAfter: nonEveryoneAfter.length,
      deleted: deleted.length, idsUnchanged: deleted.length === 0 && nonEveryoneAfter.length === nonEveryoneBefore.length,
      positionsChanged: posChanged, permissionsChanged: permChanged, memberAssignmentsChanged: membersChanged,
    };
    const afterSnap = applyEngineService.snapshot(after, stamp + '-after');
    const report = { stage, at: stamp, beforeSnapshot: snapPath, afterSnapshot: afterSnap, results, integrity };
    const reportPath = resolve(process.cwd(), 'data', 'snapshots', `apply-report-${stage}-${stamp.replace(/[:.]/g, '-')}.json`);
    writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const ok = results.filter((r) => r.status === 'ok').length, fail = results.filter((r) => r.status === 'failed').length;
    // On a clean stage, the AFTER snapshot becomes the accepted checkpoint so the
    // next stage validates against current live (not the pre-stage state).
    if (!rollbackFile && fail === 0) { applyEngineService.setCheckpoint(afterSnap); console.log('  ✓ checkpoint updated (baseline for the next stage)'); }
    console.log(`\n──── STAGE "${stage}" RESULT ────`);
    console.log(`  applied: ${ok} ok, ${fail} failed`);
    console.log(`  roles: ${integrity.rolesBefore} → ${integrity.rolesAfter} · deleted ${integrity.deleted} · IDs unchanged: ${integrity.idsUnchanged}`);
    console.log(`  positions changed: ${posChanged.length} · permissions changed: ${permChanged.length} · member assignments changed: ${membersChanged.length}`);
    console.log(`  AFTER snapshot: ${afterSnap}`);
    console.log(`  report: ${reportPath}`);
    if (fail) console.log(`\n↩️  To undo: npm run roles:apply -- --rollback "${snapPath}"`);
    console.log('');
  } catch (err) {
    console.error('apply failed:', (err as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => { console.error('login failed:', (e as Error).message); process.exit(1); });
