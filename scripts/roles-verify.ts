/**
 * READ-ONLY Stage verification / recovery. Confirms the live server matches the
 * expected post-stage state, writes the AFTER snapshot + integrity report, and
 * updates the checkpoint. It performs NO role edits, so it's safe while the
 * mutation lock is on (use it to recover when a post-apply verify was rate-limited).
 *
 *   npm run roles:verify
 *
 * Rate-limit tolerant: retries fetches, respecting retry_after + a safety margin.
 */
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { initDatabase } from '../src/database/index.js';
import { credentials } from '../src/config/credentials.js';
import { applyEngineService } from '../control-center/server/services/applyEngineService.js';
import { roleManagerService, type RoleData } from '../control-center/server/services/roleManagerService.js';

/* eslint-disable no-console */
initDatabase();
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
  throw new Error(`unreachable`);
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
  try {
    const guild = await client.guilds.fetch(guildId);
    await withRetry(() => guild.roles.fetch().then(() => undefined), 'roles.fetch');
    await withRetry(() => guild.members.fetch().then(() => undefined), 'members.fetch'); // opcode 8

    const live = liveRoleData(guild);
    const liveById = new Map(live.map((r) => [r.id, r]));
    const audit = roleManagerService.loadAudit();
    const auditById = new Map(audit.roles.map((r) => [r.id, r]));
    const view = roleManagerService.view().roles;
    const hoistOps = applyEngineService.plan().ops.filter((o) => o.type === 'HOIST'); // to=false
    const keepHoisted = view.filter((r) => r.proposedHoist === true).map((r) => ({ id: r.id, name: r.proposedName ?? r.name }));

    const norm = (a?: string[]) => JSON.stringify([...(a ?? [])].sort());
    const nonEvBefore = audit.roles.filter((r) => !r.isEveryone);
    const nonEvLive = live.filter((r) => !r.isEveryone);
    const deleted = nonEvBefore.filter((r) => !liveById.has(r.id)).map((r) => r.name);
    const added = nonEvLive.filter((r) => !auditById.has(r.id)).map((r) => r.id);

    const unhoistPending = hoistOps.filter((o) => liveById.get(o.roleId)?.hoist !== false).map((o) => o.roleName);
    const keepHoistedBroken = keepHoisted.filter((k) => liveById.get(k.id)?.hoist !== true).map((k) => k.name);
    const posChanged = nonEvBefore.filter((r) => liveById.get(r.id) && liveById.get(r.id)!.position !== r.position).map((r) => r.name);
    const permChanged = nonEvBefore.filter((r) => liveById.get(r.id) && norm(liveById.get(r.id)!.permissions) !== norm(r.permissions)).map((r) => r.name);
    const memberCountChanged = nonEvBefore.filter((r) => liveById.get(r.id) && liveById.get(r.id)!.memberCount !== r.memberCount).map((r) => `${r.name} (${r.memberCount}→${liveById.get(r.id)!.memberCount})`);

    const pass = (b: boolean) => (b ? '✅' : '❌');
    console.log('\n════════ STAGE 2 LIVE INTEGRITY (read-only) ════════');
    console.log(`${pass(nonEvLive.length === 43)} Roles = ${nonEvLive.length} (expected 43)`);
    console.log(`${pass(deleted.length === 0)} Deleted = ${deleted.length}${deleted.length ? ' → ' + deleted.join(', ') : ''}`);
    console.log(`${pass(added.length === 0)} Added/unknown = ${added.length}`);
    console.log(`${pass(unhoistPending.length === 0)} 17 target roles hoist=false: ${17 - unhoistPending.length}/17${unhoistPending.length ? ' — still hoisted: ' + unhoistPending.join(', ') : ''}`);
    console.log(`${pass(keepHoistedBroken.length === 0)} 6 kept hoisted: ${keepHoisted.length - keepHoistedBroken.length}/${keepHoisted.length}${keepHoistedBroken.length ? ' — NOT hoisted: ' + keepHoistedBroken.join(', ') : ''}`);
    console.log(`${pass(posChanged.length === 0)} Positions unchanged${posChanged.length ? ' — changed: ' + posChanged.join(', ') : ''}`);
    console.log(`${pass(permChanged.length === 0)} Permissions unchanged${permChanged.length ? ' — changed: ' + permChanged.join(', ') : ''}`);
    console.log(`${pass(memberCountChanged.length === 0)} Member assignments unchanged${memberCountChanged.length ? ' — changed: ' + memberCountChanged.join(', ') : ''}`);
    console.log('ℹ️  Private rooms: untouched (this tool never edits channels/roles).');

    const stage2Complete = unhoistPending.length === 0 && keepHoistedBroken.length === 0;
    const integrityOk = stage2Complete && deleted.length === 0 && added.length === 0 && posChanged.length === 0 && permChanged.length === 0 && memberCountChanged.length === 0 && nonEvLive.length === 43;

    const stamp = new Date().toISOString();
    const afterSnap = applyEngineService.snapshot(live, stamp + '-stage2-after');
    console.log(`\n📸 AFTER snapshot written: ${afterSnap}`);
    if (integrityOk) {
      applyEngineService.setCheckpoint(afterSnap);
      console.log('✓ Checkpoint updated (Stage 2 accepted as the new baseline).');
      console.log('\n✅ STAGE 2 COMPLETE — all 17 hoist changes are live and integrity holds. Do NOT reapply.');
    } else if (stage2Complete) {
      console.log('\n⚠️ Hoist changes are all live, but an unexpected integrity difference was found above — review before checkpointing.');
    } else {
      console.log(`\n❗ ${unhoistPending.length} hoist change(s) did NOT persist: ${unhoistPending.join(', ')}. Re-run Stage 2 (idempotent — it will skip already-applied and only fix these).`);
    }
  } catch (err) {
    console.error('verify failed:', (err as Error).message);
  } finally {
    await client.destroy();
    process.exit(0);
  }
});

client.login(token).catch((e) => { console.error('login failed:', (e as Error).message); process.exit(1); });
