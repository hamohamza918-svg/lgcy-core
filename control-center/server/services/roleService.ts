import { getDataSource } from '../discord/index.js';
import type { DiscordRole } from '../discord/types.js';
import { configService } from './configService.js';

/** Same staff/security name patterns the bot enforces for self-roles. */
const STAFF_NAME_DENYLIST = [
  /owner/i, /co[-\s]?owner/i, /admin/i, /moderator/i, /\bmod\b/i,
  /developer/i, /\bdev\b/i, /support/i, /staff/i, /security/i, /manager/i,
];

export interface RoleView extends DiscordRole {
  isStaffLike: boolean;
  botCanManage: boolean;
  selfRoleBlockReason: string | null;
}

/** Pure self-role safety check mirroring the bot's selfRoleBlockReason. */
export function selfRoleBlockReason(
  role: DiscordRole,
  botPos: number,
  staffRoleIds: string[],
): string | null {
  if (role.managed) return 'managed/integration roles cannot be self-assigned';
  if (role.hasAdministrator) return 'roles with Administrator cannot be self-assigned';
  if (staffRoleIds.includes(role.id)) return 'this role is marked as a staff role';
  if (STAFF_NAME_DENYLIST.some((re) => re.test(role.name))) return `the name "${role.name}" looks like a staff/security role`;
  if (role.position >= botPos) return "the role is at/above the bot's top role, so it can't be assigned";
  return null;
}

export const roleService = {
  async list(): Promise<RoleView[]> {
    const snap = await getDataSource().snapshot();
    const cfg = configService.getApplied();
    const staffIds = [...cfg.staffRoleIds, ...cfg.ticketStaffRoleIds];
    const botPos = snap.bot.topRolePosition;
    return snap.roles
      .slice()
      .sort((a, b) => b.position - a.position)
      .map((r) => ({
        ...r,
        isStaffLike: STAFF_NAME_DENYLIST.some((re) => re.test(r.name)),
        botCanManage: !r.managed && r.position < botPos,
        selfRoleBlockReason: selfRoleBlockReason(r, botPos, staffIds),
      }));
  },

  /** Validate that a role may be added as a self-role (used before save). */
  async checkAddSelfRole(roleId: string): Promise<{ ok: boolean; reason?: string }> {
    const snap = await getDataSource().snapshot();
    const role = snap.roles.find((r) => r.id === roleId);
    if (!role) return { ok: false, reason: 'Role not found.' };
    const cfg = configService.getApplied();
    const reason = selfRoleBlockReason(role, snap.bot.topRolePosition, [...cfg.staffRoleIds, ...cfg.ticketStaffRoleIds]);
    return reason ? { ok: false, reason } : { ok: true };
  },
};
