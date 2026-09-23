import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { appSettingsRepo } from '../../../src/database/repositories/appSettingsRepo.js';
import { activeGuildId } from './configService.js';

/**
 * Role Manager — operates on the REAL 43 roles captured by `npm run audit:roles`
 * (preview/role-audit.json). All editing is staged in a local draft; NOTHING is
 * written to Discord here (the global mutation lock still guards apply).
 */

export interface RoleData {
  name: string;
  id: string;
  position: number;
  color: string;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean;
  administrator: boolean;
  memberCount: number;
  members: string[];
  permissions: string[];
  channelDependencies: string[];
  isEveryone: boolean;
  botCanManage: boolean;
}
interface AuditFile {
  guild: { id: string; name: string; memberCount: number };
  botTopPosition: number;
  roles: RoleData[];
}

export type Category =
  | 'ownership' | 'bot' | 'management' | 'staff' | 'status'
  | 'community' | 'economy' | 'special' | 'game' | 'moderation' | 'unknown';

/** Category + proposed LGCY cleanup per real role ID (from the approved audit).
 * hoist=true only for the ~6 identity/staff roles that deserve a sidebar group;
 * everything else hoist=false (clean member list). Managed bot roles get no
 * name/color/hoist (Discord locks managed roles). */
const PLAN: Record<string, { cat: Category; name?: string; color?: string; hoist?: boolean }> = {
  // 👑 ownership
  '1534981491140988968': { cat: 'ownership', name: '👑 ︱ Server Owner', color: '#F5C542', hoist: true },
  '1534981506747994132': { cat: 'ownership', name: '♛ ︱ Co-Owner', color: '#F0B429', hoist: true },
  '1534981494018281492': { cat: 'ownership', name: '✦ ︱ Owner Allies', color: '#E8A317', hoist: false },
  // 🤖 bots (managed — no edits possible)
  '1551612525336858747': { cat: 'bot' },
  '1534981173581975736': { cat: 'bot' },
  '1534983385221562630': { cat: 'bot' },
  '1535007958159851653': { cat: 'bot' },
  '1545535769588793397': { cat: 'bot' },
  // ⚙️ management
  '1534981496912351474': { cat: 'management', name: '🛠 ︱ Developer', color: '#7B5CFF', hoist: true },
  '1534981503631622235': { cat: 'management', name: '✦ ︱ Head Manager', color: '#8A6BFF', hoist: true },
  '1534981510032134285': { cat: 'management', name: '◇ ︱ Consultant', color: '#9E6BFF', hoist: false },
  // 🛡️ staff
  '1534981553992765731': { cat: 'staff', name: '🎉 ︱ Event Manager', color: '#2B8CFF', hoist: true },
  '1534981563127697501': { cat: 'staff', name: '🎫 ︱ Ticket Support', color: '#4FD2FF', hoist: false },
  // 💎 status
  '1534981500200816830': { cat: 'status', name: '💎 ︱ Royalty', color: '#4FD2FF', hoist: false },
  '1534981513160949991': { cat: 'status', name: '◈ ︱ Big Boss', color: '#4AC7FA', hoist: false },
  '1534981516176654446': { cat: 'status', name: '◈ ︱ Boss', color: '#45BCF5', hoist: false },
  '1534981519041499196': { cat: 'status', name: '◈ ︱ CEO', color: '#40B1F0', hoist: false },
  '1534981522053140500': { cat: 'status', name: '◈ ︱ Founder', color: '#3BA6EB', hoist: false },
  '1534981525001605371': { cat: 'status', name: '◈ ︱ Co-Founder', color: '#369BE6', hoist: false },
  '1534981527774036209': { cat: 'status', name: '◈ ︱ President', color: '#3190E1', hoist: false },
  '1534981530613710959': { cat: 'status', name: '◈ ︱ Vice President', color: '#2C85DC', hoist: false },
  '1534981533813837884': { cat: 'status', name: '◈ ︱ Titan', color: '#2B8CFF', hoist: false },
  '1534981537844564070': { cat: 'status', name: '◈ ︱ General', color: '#2B8CFF', hoist: false },
  '1534981541296603438': { cat: 'status', name: '◈ ︱ Dragon', color: '#2B8CFF', hoist: false },
  '1534981544282820628': { cat: 'status', name: '◈ ︱ Ghost', color: '#2B8CFF', hoist: false },
  '1534981548091375666': { cat: 'status', name: '♛ ︱ Elite', color: '#4FD2FF', hoist: false },
  // 👤 community
  '1534981551052296202': { cat: 'community', name: '✧ ︱ LGCY Member', color: '#35D07F', hoist: true },
  // 💰 economy
  '1534981604429267096': { cat: 'economy', name: '🌾 ︱ Farm Owner', color: '#F5A623', hoist: false },
  '1534981608807989318': { cat: 'economy', name: '🏡 ︱ Villa Owner', color: '#F5A623', hoist: false },
  '1534981611462856787': { cat: 'economy', name: '🏭 ︱ Factory Owner', color: '#F5A623', hoist: false },
  // 🔒 special
  '1534981557025243318': { cat: 'special', name: '🔔 ︱ Events', color: '#9E6BFF', hoist: false },
  '1534981560275828917': { cat: 'special', name: '🤖 ︱ Bots', color: '#99AAB5', hoist: false },
  // 🎮 game
  '1534981598351724634': { cat: 'game', name: '🎮 ︱ FiveM', color: '#E67E22', hoist: false },
  '1534981594081792173': { cat: 'game', name: '🎮 ︱ Minecraft', color: '#2ECC71', hoist: false },
  '1534981581809127578': { cat: 'game', name: '🎮 ︱ ARK', color: '#16A085', hoist: false },
  '1534981591250505749': { cat: 'game', name: '🎮 ︱ FIFA', color: '#C0C6CE', hoist: false },
  '1534981585516888205': { cat: 'game', name: '🎮 ︱ Overwatch', color: '#F39C12', hoist: false },
  // ⚠️ moderation
  '1534981566688919573': { cat: 'moderation', name: '⚠ ︱ Warning 1', color: '#FF5A6A', hoist: false },
  '1534981569805025371': { cat: 'moderation', name: '⚠ ︱ Warning 2', color: '#F04656', hoist: false },
  '1534981572975919208': { cat: 'moderation', name: '⚠ ︱ Warning 3', color: '#D93544', hoist: false },
  '1534981576637677859': { cat: 'moderation', name: '⛔ ︱ Demoted', color: '#8892A6', hoist: false },
  '1534981601551974662': { cat: 'moderation', name: '🔇 ︱ Muted', color: '#5A6472', hoist: false },
  // ❓ unknown
  '1534981614835339265': { cat: 'unknown', name: '❓ ︱ Unused', color: '#607080', hoist: false },
};

const CAT_LABEL: Record<Category, string> = {
  ownership: '👑 Ownership', bot: '🤖 Bot / Integration', management: '⚙️ Management',
  staff: '🛡️ Staff', status: '💎 Status / Rank', community: '👤 Community',
  economy: '💰 Economy', special: '🔒 Special', game: '🎮 Game Access',
  moderation: '⚠️ Moderation State', unknown: '❓ Other',
};

/** Category order = the approved top→bottom hierarchy grouping (ownership first,
 * then high-trust bots, per the approved structure). */
const CAT_ORDER: Category[] = ['ownership', 'bot', 'management', 'staff', 'status', 'community', 'economy', 'special', 'game', 'moderation', 'unknown'];

const DANGEROUS: Record<string, 'high' | 'med'> = {
  Administrator: 'high', ManageRoles: 'high', ManageGuild: 'high', BanMembers: 'high',
  KickMembers: 'high', ManageChannels: 'high', ManageWebhooks: 'high',
  MentionEveryone: 'med', ModerateMembers: 'med',
};

function auditPath() {
  return resolve(process.cwd(), 'preview', 'role-audit.json');
}
function draftKey() {
  return `roleManager:${activeGuildId()}`;
}

interface RoleEdit {
  name?: string; color?: string; hoist?: boolean; mentionable?: boolean;
  permsAdd?: string[]; permsRemove?: string[]; protectedOverride?: boolean;
}
interface RoleDraft { order: string[] | null; edits: Record<string, RoleEdit> }

export const roleManagerService = {
  available(): boolean {
    return existsSync(auditPath());
  },

  loadAudit(): AuditFile {
    if (!this.available()) throw new Error('No role snapshot found. Run `npm run audit:roles` first.');
    return JSON.parse(readFileSync(auditPath(), 'utf8')) as AuditFile;
  },

  getDraft(): RoleDraft {
    return appSettingsRepo.getJSON<RoleDraft>(draftKey()) ?? { order: null, edits: {} };
  },
  hasDraft(): boolean {
    const d = appSettingsRepo.getJSON<RoleDraft>(draftKey());
    return !!d && (d.order !== null || Object.keys(d.edits).length > 0);
  },
  saveEdit(roleId: string, edit: RoleEdit): void {
    const d = this.getDraft();
    d.edits[roleId] = { ...d.edits[roleId], ...edit };
    appSettingsRepo.setJSON(draftKey(), d);
  },
  saveOrder(order: string[]): void {
    const d = this.getDraft();
    d.order = order;
    appSettingsRepo.setJSON(draftKey(), d);
  },
  discard(): void {
    appSettingsRepo.delete(draftKey());
  },

  /** Auto-protected: ownership, managed bots, and any Administrator role. */
  isProtected(r: RoleData, edit?: RoleEdit): boolean {
    if (edit?.protectedOverride !== undefined) return edit.protectedOverride;
    return PLAN[r.id]?.cat === 'ownership' || r.managed || r.administrator;
  },

  /** The full role view for the UI (current + proposed + flags), in hierarchy order. */
  view() {
    const audit = this.loadAudit();
    const draft = this.getDraft();
    const roles = audit.roles.filter((r) => !r.isEveryone);

    const enriched = roles.map((r) => {
      const plan = PLAN[r.id] ?? { cat: 'unknown' as Category };
      const edit = draft.edits[r.id] ?? {};
      return {
        ...r,
        category: plan.cat,
        categoryLabel: CAT_LABEL[plan.cat],
        proposedName: plan.name ?? null,
        proposedColor: plan.color ?? null,
        proposedHoist: plan.hoist ?? null,
        protectedRole: this.isProtected(r, edit),
        dangerousPerms: r.permissions.filter((p) => DANGEROUS[p]),
        draftEdit: edit,
      };
    });

    // Ordering: use draft.order if present, else group by category then position.
    let ordered = enriched;
    if (draft.order) {
      const idx = new Map(draft.order.map((id, i) => [id, i]));
      ordered = [...enriched].sort((a, b) => (idx.get(a.id) ?? 999) - (idx.get(b.id) ?? 999));
    } else {
      ordered = [...enriched].sort((a, b) =>
        CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || b.position - a.position);
    }

    return {
      guild: audit.guild,
      botTopPosition: audit.botTopPosition,
      categories: CAT_ORDER.map((c) => ({ key: c, label: CAT_LABEL[c] })),
      roles: ordered,
      hasDraft: this.hasDraft(),
    };
  },

  /** Exact per-operation diff between current state and the draft. */
  diff() {
    const audit = this.loadAudit();
    const draft = this.getDraft();
    const byId = new Map(audit.roles.map((r) => [r.id, r]));
    const ops: { type: string; roleId: string; roleName: string; from: unknown; to: unknown }[] = [];

    for (const [id, e] of Object.entries(draft.edits)) {
      const r = byId.get(id); if (!r) continue;
      if (e.name !== undefined && e.name !== r.name) ops.push({ type: 'RENAME', roleId: id, roleName: r.name, from: r.name, to: e.name });
      if (e.color !== undefined && e.color.toLowerCase() !== r.color.toLowerCase()) ops.push({ type: 'COLOR', roleId: id, roleName: r.name, from: r.color, to: e.color });
      if (e.hoist !== undefined && e.hoist !== r.hoist) ops.push({ type: 'HOIST', roleId: id, roleName: r.name, from: r.hoist, to: e.hoist });
      if (e.mentionable !== undefined && e.mentionable !== r.mentionable) ops.push({ type: 'MENTIONABLE', roleId: id, roleName: r.name, from: r.mentionable, to: e.mentionable });
      for (const p of e.permsRemove ?? []) if (r.permissions.includes(p)) ops.push({ type: 'PERM-REMOVE', roleId: id, roleName: r.name, from: p, to: null });
      for (const p of e.permsAdd ?? []) if (!r.permissions.includes(p)) ops.push({ type: 'PERM-ADD', roleId: id, roleName: r.name, from: null, to: p });
    }
    if (draft.order) {
      const manageable = audit.roles.filter((r) => !r.isEveryone && r.botCanManage).sort((a, b) => b.position - a.position).map((r) => r.id);
      const desired = draft.order.filter((id) => manageable.includes(id));
      if (JSON.stringify(desired) !== JSON.stringify(manageable)) {
        ops.push({ type: 'REORDER', roleId: '-', roleName: `${desired.length} manageable roles`, from: 'current order', to: 'new order' });
      }
    }
    return ops;
  },

  /** Smart warnings that explain the consequence. */
  warnings() {
    const audit = this.loadAudit();
    const w: { level: 'high' | 'med' | 'info'; text: string }[] = [];
    for (const r of audit.roles) {
      if (r.isEveryone) continue;
      const cat = PLAN[r.id]?.cat;
      if (r.administrator && cat !== 'ownership' && !r.managed)
        w.push({ level: 'high', text: `${r.name} has **Administrator** — full control of the server. Consider removing unless it's a true owner.` });
      if (cat === 'game' && r.permissions.includes('MentionEveryone'))
        w.push({ level: 'med', text: `${r.name} can **Mention @everyone** — a game role shouldn't ping everyone.` });
      if (cat === 'status' && (r.permissions.includes('ModerateMembers') || r.permissions.includes('MuteMembers')))
        w.push({ level: 'med', text: `${r.name} carries moderation perms despite being a STATUS role — recommend stripping them.` });
      if (r.channelDependencies.length >= 4)
        w.push({ level: 'info', text: `${r.name} is referenced by ${r.channelDependencies.length} channel permission overwrites — changing/removing it affects those channels.` });
    }
    return w;
  },

  /** Bot dependency analysis for the 5 managed integration roles. */
  botAnalysis() {
    const audit = this.loadAudit();
    const infer: Record<string, { assigns: string; manages: string; minPos: string; adminRemovable: string; deps: string }> = {
      ASCEND: { assigns: 'unknown (verify in ASCEND dashboard)', manages: 'unknown', minPos: 'keep above any roles it assigns', adminRemovable: 'risky — only if you know its feature set', deps: 'ASCEND bot' },
      'LGCY Core': { assigns: 'game self-roles, Muted, (future) warnings', manages: 'ticket channels it creates', minPos: 'ABOVE game + Muted + warnings + status it assigns; BELOW ownership', adminRemovable: 'N/A (no Administrator — already minimal)', deps: 'this bot' },
      Boogie: { assigns: 'likely economy / warning roles', manages: 'economy/automod features', minPos: 'above economy + warning roles', adminRemovable: 'risky — Boogie uses Administrator; test in a safe channel first', deps: 'Boogie bot, economy, warnings' },
      'Ticket Tool': { assigns: 'Ticket Support / per-ticket access', manages: 'ticket channels + overwrites', minPos: 'above Ticket Support + members it manages', adminRemovable: 'has no Admin — fine as is', deps: 'Ticket Tool, ticket channels' },
      'Lara✨': { assigns: 'likely economy/property roles', manages: 'music/economy', minPos: 'above roles it assigns', adminRemovable: 'risky — Lara uses Administrator', deps: 'Lara bot, economy' },
    };
    return audit.roles.filter((r) => r.managed).map((r) => ({
      name: r.name, id: r.id, position: r.position, administrator: r.administrator,
      permissions: r.permissions, ...(infer[r.name] ?? { assigns: 'unknown', manages: 'unknown', minPos: 'unchanged', adminRemovable: 'unknown', deps: r.name }),
    }));
  },
};
