import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  type Guild,
  type Role,
} from 'discord.js';
import { BRAND } from '../../config/constants.js';
import { getGuildConfig, type SelfRoleGroup } from '../../config/guildConfig.js';
import { buildCustomId } from '../../types/index.js';

/**
 * Staff/security role name patterns. A role whose name matches ANY of these can
 * NEVER be offered as a self-role, regardless of configuration — a defence in
 * depth on top of the explicit staffRoleIds list.
 */
const STAFF_NAME_DENYLIST = [
  /owner/i,
  /co[-\s]?owner/i,
  /admin/i,
  /moderator/i,
  /\bmod\b/i,
  /developer/i,
  /\bdev\b/i,
  /support/i,
  /staff/i,
  /security/i,
  /manager/i,
];

/**
 * Returns a human reason if the role must NOT be self-assignable, or null if it
 * is safe to offer. Blocks: @everyone, managed/integration roles, staff by name,
 * configured staff roles, and any role at or above the bot's highest role.
 */
export function selfRoleBlockReason(role: Role, guild: Guild): string | null {
  const cfg = getGuildConfig(guild.id);

  if (role.id === guild.id) return 'the @everyone role cannot be a self-role';
  if (role.managed) return 'managed/integration roles cannot be self-assigned';
  if (cfg.staffRoleIds.includes(role.id)) return 'this role is marked as a staff role';
  if (role.permissions.has('Administrator'))
    return 'roles with Administrator cannot be self-assigned';
  if (STAFF_NAME_DENYLIST.some((re) => re.test(role.name)))
    return `the name "${role.name}" looks like a staff/security role`;

  const me = guild.members.me;
  if (me && role.comparePositionTo(me.roles.highest) >= 0)
    return "the role is higher than my top role, so I can't assign it";

  return null;
}

/** Whether the bot can currently assign/remove a role (hierarchy + managed). */
export function botCanAssign(role: Role, guild: Guild): boolean {
  const me = guild.members.me;
  if (!me) return false;
  return !role.managed && role.comparePositionTo(me.roles.highest) < 0;
}

/** Builds the select-menu component for a self-role group. */
export function buildGroupComponents(
  guild: Guild,
  group: SelfRoleGroup,
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const options = group.roles
    .map((r) => {
      const role = guild.roles.cache.get(r.roleId);
      // Skip roles that no longer exist or became unsafe to offer.
      if (!role || selfRoleBlockReason(role, guild)) return null;
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(r.label)
        .setValue(r.roleId);
      if (r.description) opt.setDescription(r.description.slice(0, 100));
      if (r.emoji) opt.setEmoji(r.emoji);
      return opt;
    })
    .filter((o): o is StringSelectMenuOptionBuilder => o !== null);

  if (options.length === 0) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId(buildCustomId('roles', 'select', group.key))
    .setPlaceholder(group.placeholder ?? `Choose your ${group.label} roles`)
    .setMinValues(group.minValues)
    .setMaxValues(
      group.exclusive ? 1 : Math.min(group.maxValues, options.length),
    )
    .addOptions(options);

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

/** Builds the panel embed for a group. */
export function buildGroupEmbed(group: SelfRoleGroup): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND.colorPrimary)
    .setTitle(`🎭 ${group.label}`)
    .setDescription(
      group.description ??
        'Select the roles you want below. Pick again to remove them.',
    );
}
