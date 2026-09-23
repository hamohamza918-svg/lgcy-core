import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { appSettingsRepo } from '../../../src/database/repositories/appSettingsRepo.js';
import { activeGuildId } from './configService.js';
import { roleManagerService, type RoleData } from './roleManagerService.js';

/**
 * Apply Engine — turns the approved role proposal into an explicit, selectable
 * operation list, snapshots live state for rollback, validates against the live
 * server for drift, and (via the CLI runner) applies sequentially with per-op
 * verification. Building/planning here NEVER mutates Discord.
 *
 * First deployment = SAFE ops only: RENAME, COLOR, HOIST (all selected).
 * MOVE ops are prepared but default-DESELECTED (reorder needs live validation).
 * Permission changes are HELD entirely (separate review) — never in this apply.
 */

export type OpType = 'RENAME' | 'COLOR' | 'HOIST' | 'MOVE';

/**
 * Which structural op types a given apply-stage is responsible for. Used to
 * scope validateLive()'s plan-classification so a stage only validates its OWN
 * operations. Stages handled outside buildOps() map to none:
 *   - 'lgcy'    → the managed-bot-role move (validated in-stage; managed roles
 *                 aren't in buildOps at all)
 *   - 'perms:*' → permission ops (classified separately from permissionOps())
 * An undefined stage keeps the legacy full-plan classification (dashboard).
 */
const STAGE_OP_TYPES: Record<string, OpType[]> = {
  names: ['RENAME', 'COLOR'],
  hoist: ['HOIST'],
  all: ['RENAME', 'COLOR', 'HOIST', 'MOVE'],
};
export interface Op {
  id: string;
  type: OpType;
  roleId: string;
  roleName: string;
  from: unknown;
  to: unknown;
  category: string;
  protectedRole: boolean;
  selectedDefault: boolean;
}

function selKey() {
  return `applyPlan:${activeGuildId()}`;
}
function getOverrides(): Record<string, boolean> {
  return appSettingsRepo.getJSON<Record<string, boolean>>(selKey()) ?? {};
}

export const applyEngineService = {
  /** Builds the full op list from the approved proposal (no Discord calls). */
  buildOps(): Op[] {
    const view = roleManagerService.view();
    const roles = view.roles;
    const ops: Op[] = [];
    const orderable = roles.filter((r) => !r.managed);
    const total = orderable.length;

    roles.forEach((r) => {
      if (r.managed) return; // managed roles can't be edited
      if (r.proposedName && r.proposedName !== r.name)
        ops.push(op('RENAME', r, r.name, r.proposedName, true));
      if (r.proposedColor && r.proposedColor.toLowerCase() !== r.color.toLowerCase())
        ops.push(op('COLOR', r, r.color, r.proposedColor, true));
      if (r.proposedHoist !== null && r.proposedHoist !== r.hoist)
        ops.push(op('HOIST', r, r.hoist, r.proposedHoist, true));
    });

    // MOVE ops: target rank from the proposed hierarchy order (top = highest).
    orderable.forEach((r, i) => {
      const targetPos = total - i; // higher = nearer top
      if (targetPos !== r.position)
        ops.push(op('MOVE', r, r.position, targetPos, false)); // deselected by default
    });

    return ops;
  },

  /** Ops with the user's selection applied. */
  plan() {
    const ops = this.buildOps();
    const ov = getOverrides();
    const withSel = ops.map((o) => ({ ...o, selected: ov[o.id] ?? o.selectedDefault }));
    const sel = withSel.filter((o) => o.selected);
    return {
      ops: withSel,
      counts: {
        renames: sel.filter((o) => o.type === 'RENAME').length,
        colors: sel.filter((o) => o.type === 'COLOR').length,
        moves: sel.filter((o) => o.type === 'MOVE').length,
        hoist: sel.filter((o) => o.type === 'HOIST').length,
        permissions: 0,
        memberAssignments: 0,
        deletes: 0,
      },
      held: this.heldReview(),
      sidebar: this.sidebarPreview(),
      selectedCount: sel.length,
    };
  },

  toggle(opId: string, selected: boolean): void {
    const ov = getOverrides();
    ov[opId] = selected;
    appSettingsRepo.setJSON(selKey(), ov);
  },
  reset(): void {
    appSettingsRepo.delete(selKey());
  },

  /** Dangerous permission changes intentionally EXCLUDED from the first apply. */
  heldReview() {
    return [
      { role: '🛠 ︱ Developer', change: 'Remove Administrator → grant scoped (Manage Channels / View Audit Log)' },
      { role: '♛ ︱ Co-Owner', change: 'Reduce: Manage Webhooks, Mention Everyone, Manage Expressions' },
      { role: '✦ ︱ Head Manager', change: 'Reduce: Manage Webhooks, Manage Expressions' },
      { role: '◇ ︱ Consultant', change: 'Reduce: Manage Roles, Manage Webhooks' },
      { role: 'Status ranks (Big Boss…President)', change: 'Strip Moderate/Mute Members + Manage Nicknames (vanity ranks)' },
      { role: '🎮 FIFA / FiveM / 🤖 Bots', change: 'Strip Mention Everyone' },
    ];
  },

  /** Which roles would form member-list sidebar groups after apply (hoisted). */
  sidebarPreview() {
    const ov = getOverrides();
    const ops = this.buildOps();
    const hoistOpFor = new Map(ops.filter((o) => o.type === 'HOIST').map((o) => [o.roleId, o]));
    return roleManagerService.view().roles
      .filter((r) => {
        const ho = hoistOpFor.get(r.id);
        const willHoist = ho ? (ov[ho.id] ?? ho.selectedDefault ? (ho.to as boolean) : r.hoist) : r.hoist;
        return willHoist;
      })
      .map((r) => ({ id: r.id, name: r.proposedName ?? r.name, color: r.proposedColor ?? r.color }));
  },

  /**
   * Tagged role-PERMISSION operations (Phase 2, stage 3B), split into approval
   * groups. Removes are intersected with the role's actual current perms
   * (idempotent). Managed bot roles are never included (perms not editable).
   *   3b1        — low-risk MentionEveryone removals
   *   3b2-safe   — status ranks with 0 members + no mgmt-channel deps
   *   3b2-review — status ranks with members OR SYSTEM/file-log deps (held)
   *   3b3        — management roles (held; Developer keeps Administrator)
   */
  permissionOps() {
    const audit = roleManagerService.loadAudit();
    const byId = new Map(audit.roles.map((r) => [r.id, r]));
    const STATUS_MOD = ['ModerateMembers', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageNicknames', 'ViewAuditLog', 'ManageMessages'];
    const spec: { group: string; id: string; remove: string[]; add?: string[] }[] = [
      // 3b1 — MentionEveryone
      ...['1534981591250505749', '1534981598351724634', '1534981560275828917', '1534981519041499196', '1534981541296603438'].map((id) => ({ group: '3b1', id, remove: ['MentionEveryone'] })),
      // 3b2-safe — 0 members, no mgmt-channel deps
      ...['1534981530613710959', '1534981533813837884', '1534981537844564070'].map((id) => ({ group: '3b2-safe', id, remove: STATUS_MOD })),
      // 3b2-review — members and/or SYSTEM/file-log deps
      ...['1534981513160949991', '1534981516176654446', '1534981519041499196', '1534981522053140500', '1534981525001605371', '1534981527774036209'].map((id) => ({ group: '3b2-review', id, remove: STATUS_MOD })),
      // 3b3 — management (held). Developer keeps Administrator (no op for it here).
      { group: '3b3', id: '1534981506747994132', remove: ['ManageGuildExpressions', 'CreateGuildExpressions', 'ManageEmojisAndStickers', 'MentionEveryone'] }, // Co-Owner
      { group: '3b3', id: '1534981503631622235', remove: ['ManageWebhooks', 'ManageGuildExpressions', 'ManageEmojisAndStickers', 'CreateGuildExpressions'] }, // Head Manager
      { group: '3b3', id: '1534981510032134285', remove: ['ManageRoles', 'ManageWebhooks', 'ManageGuildExpressions', 'ManageEmojisAndStickers', 'CreateGuildExpressions'] }, // Consultant
    ];
    return spec
      .map((s) => {
        const r = byId.get(s.id);
        if (!r || r.managed) return null;
        const have = new Set(r.permissions);
        const remove = s.remove.filter((p) => have.has(p));
        const add = (s.add ?? []).filter((p) => !have.has(p));
        return remove.length || add.length ? { group: s.group, roleId: s.id, roleName: r.name, remove, add } : null;
      })
      .filter((x): x is { group: string; roleId: string; roleName: string; remove: string[]; add: string[] } => x !== null);
  },

  /** Minimum-safe bot positions (informational — bots aren't auto-moved). */
  botPositions() {
    const audit = roleManagerService.loadAudit();
    const rank = (needAbove: string[]) => needAbove; // documentation only
    return audit.roles.filter((r) => r.managed).map((r) => ({
      name: r.name, currentPosition: r.position, administrator: r.administrator,
      minSafe: r.name === 'LGCY Core'
        ? 'above game + Muted + warnings it assigns; BELOW ownership'
        : r.name === 'Ticket Tool'
          ? 'above Ticket Support + members it manages'
          : 'above any role it assigns (verify per bot)',
      note: rank([]).length ? '' : '',
    }));
  },

  /** Writes a rollback snapshot from the provided (ideally LIVE) role list. */
  snapshot(roles: RoleData[], stampIso: string): string {
    const dir = resolve(process.cwd(), 'data', 'snapshots');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `roles-${stampIso.replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({
      takenAt: stampIso,
      guildId: activeGuildId(),
      roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, position: r.position, permissions: r.permissions, members: r.members })),
    }, null, 2));
    return file;
  },

  /** Records a completed-stage AFTER snapshot as the accepted checkpoint. The
   * next stage validates invariants (positions/permissions/members) against it. */
  setCheckpoint(path: string): void {
    appSettingsRepo.set(`roleCheckpoint:${activeGuildId()}`, path);
  },
  getCheckpoint(): { path: string; roles: RoleData[] } | null {
    const p = appSettingsRepo.get(`roleCheckpoint:${activeGuildId()}`);
    if (!p || !existsSync(p)) return null;
    try { return { path: p, roles: (JSON.parse(readFileSync(p, 'utf8')).roles ?? []) as RoleData[] }; } catch { return null; }
  },

  /**
   * Stage-aware, idempotent validation against LIVE state.
   *
   * Two independent responsibilities, both preserved:
   *  1. WHOLE-STATE DRIFT vs the authoritative checkpoint — runs in FULL every
   *     time: any role added/removed, any position change, any member change, and
   *     any permission change (except the current perms-stage's intended target
   *     roles, whose delta is expected and classified in step 2) → DRIFT → abort.
   *  2. STAGE-SCOPED op classification — only the CURRENT stage's own operations
   *     are classified as ALREADY-APPLIED / PENDING. Unrelated plan ops (e.g. the
   *     legacy hierarchy MOVE targets that no longer match live after a completed
   *     or MANUAL Stage 3A) are NOT re-validated against their pre-stage
   *     original/target values — the accepted checkpoint already encodes the new
   *     hierarchy, so requiring them to equal stale from/to caused false drift.
   *
   * Drift protection is NOT weakened: step 1 still catches every unexpected live
   * change anywhere. No roles are whitelisted. An undefined `stage` keeps the
   * legacy full-plan classification (used by the dashboard's read-only view).
   */
  validateLive(liveRoles: RoleData[], stage?: string) {
    const gid = activeGuildId();
    const checkpoint = this.getCheckpoint();
    const hasCheckpoint = !!checkpoint;
    const refRoles = (hasCheckpoint ? checkpoint!.roles : roleManagerService.loadAudit().roles).filter((r) => r.id !== gid);
    const refById = new Map(refRoles.map((r) => [r.id, r]));
    const live = liveRoles.filter((r) => r.id !== gid);
    const liveById = new Map(live.map((r) => [r.id, r]));
    const drift: string[] = [];
    const alreadyApplied: string[] = [];
    const pending: string[] = [];

    // ── Stage scoping ────────────────────────────────────────────────
    const permGroup = stage && stage.startsWith('perms:') ? stage.slice(6) : null;
    const stagePermOps = permGroup ? this.permissionOps().filter((o) => o.group === permGroup) : [];
    const stagePermRoleIds = new Set(stagePermOps.map((o) => o.roleId));
    // Structural op types this stage may classify. undefined → full plan (legacy);
    // 'lgcy' / 'perms:*' → none from buildOps (handled in-stage / below).
    const opTypes: OpType[] =
      stage === undefined ? ['RENAME', 'COLOR', 'HOIST', 'MOVE']
      : permGroup || stage === 'lgcy' ? []
      : (STAGE_OP_TYPES[stage] ?? []);

    // ── 1. Whole-state drift vs checkpoint (full every time) ──────────
    for (const r of refRoles) if (!liveById.has(r.id)) drift.push(`Role "${r.name}" (${r.id}) missing live (deleted?)`);
    for (const r of live) if (!refById.has(r.id)) drift.push(`New live role ${r.id} not in ${hasCheckpoint ? 'checkpoint' : 'audit'} — re-run audit`);

    const norm = (a?: string[]) => JSON.stringify([...(a ?? [])].sort());
    for (const r of live) {
      const rf = refById.get(r.id); if (!rf) continue;
      if (rf.position !== r.position) drift.push(`${r.name}: position changed (${rf.position} → ${r.position})`);
      if (hasCheckpoint) {
        // The current perms-stage's target roles are expected to change perms;
        // their delta is classified in step 2, not counted as whole-state drift.
        if (!stagePermRoleIds.has(r.id) && norm(r.permissions) !== norm(rf.permissions)) drift.push(`${r.name}: permissions changed since checkpoint`);
        if (norm(r.members) !== norm(rf.members)) drift.push(`${r.name}: member assignments changed since checkpoint`);
      }
    }

    // ── 2a. Structural op classification (this stage's op types only) ─
    const eq = (a: unknown, b: unknown) => JSON.stringify(a).toLowerCase() === JSON.stringify(b).toLowerCase();
    for (const o of this.buildOps()) {
      if (!opTypes.includes(o.type)) continue;
      const l = liveById.get(o.roleId); if (!l) continue;
      const cur = o.type === 'RENAME' ? l.name : o.type === 'COLOR' ? l.color : o.type === 'HOIST' ? l.hoist : l.position;
      if (eq(cur, o.to)) alreadyApplied.push(`${o.type} ${o.roleName}`);
      else if (eq(cur, o.from)) pending.push(`${o.type} ${o.roleName}`);
      else drift.push(`${o.type} ${o.roleName}: unexpected value ${JSON.stringify(cur)} (neither original nor target)`);
    }

    // ── 2b. Permission op classification (this perms-stage only) ──────
    for (const o of stagePermOps) {
      const l = liveById.get(o.roleId);
      if (!l) { drift.push(`PERM ${o.roleName}: role missing live`); continue; }
      const have = l.permissions ?? [];
      const removedGone = o.remove.every((p) => !have.includes(p));
      const addsPresent = (o.add ?? []).every((p) => have.includes(p));
      // Fully applied → already-applied; otherwise pending (the per-op apply is
      // idempotent and completes any partial state). No perm drift is invented
      // here — genuine unexpected perm changes on OTHER roles are caught in step 1.
      if (removedGone && addsPresent) alreadyApplied.push(`PERM ${o.roleName}`);
      else pending.push(`PERM ${o.roleName}`);
    }

    return { ok: drift.length === 0, roleCount: live.length, referenceType: hasCheckpoint ? 'checkpoint' : 'audit', drift, alreadyApplied, pending };
  },
};

function op(type: OpType, r: { id: string; name: string; category?: string; categoryLabel?: string; protectedRole?: boolean }, from: unknown, to: unknown, selectedDefault: boolean): Op {
  return { id: `${type}:${r.id}`, type, roleId: r.id, roleName: r.name, from, to, category: r.categoryLabel ?? '', protectedRole: !!r.protectedRole, selectedDefault };
}
