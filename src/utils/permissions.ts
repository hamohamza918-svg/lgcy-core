import {
  GuildMember,
  PermissionsBitField,
  type PermissionResolvable,
  type Guild,
} from 'discord.js';

/**
 * Central permission & hierarchy guards. The bot NEVER assumes Administrator —
 * every command declares the specific permissions it needs and these helpers
 * enforce both the invoker's permissions and Discord's role hierarchy rules.
 */

export interface PermissionCheck {
  ok: boolean;
  /** Human-readable reason, present when ok === false. */
  reason?: string;
  /** Missing permission names, when applicable. */
  missing?: string[];
}

const OK: PermissionCheck = { ok: true };

/** Does the member hold ALL of the required permissions? */
export function memberHasPermissions(
  member: GuildMember,
  required: PermissionResolvable[],
): PermissionCheck {
  if (required.length === 0) return OK;
  const missing = member.permissions.missing(required);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'You do not have permission to use this command.',
      missing,
    };
  }
  return OK;
}

/** Does the bot hold ALL of the required guild-level permissions? */
export function botHasPermissions(
  guild: Guild,
  required: PermissionResolvable[],
): PermissionCheck {
  if (required.length === 0) return OK;
  const me = guild.members.me;
  if (!me) return { ok: false, reason: 'Bot member not found in guild.' };
  const missing = me.permissions.missing(required);
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `I am missing required permissions: ${missing.join(', ')}.`,
      missing,
    };
  }
  return OK;
}

/**
 * Can `moderator` take a moderation action against `target`?
 * Enforces: not self, not the guild owner, not the bot, invoker outranks
 * target, and the bot outranks target.
 */
export function canModerate(
  moderator: GuildMember,
  target: GuildMember,
): PermissionCheck {
  const guild = target.guild;

  if (target.id === moderator.id) {
    return { ok: false, reason: 'You cannot moderate yourself.' };
  }
  if (target.id === guild.ownerId) {
    return { ok: false, reason: 'You cannot moderate the server owner.' };
  }
  if (target.id === guild.members.me?.id) {
    return { ok: false, reason: "You cannot use me against myself." };
  }

  // Invoker must be strictly higher than the target (owner bypasses).
  if (
    moderator.id !== guild.ownerId &&
    moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0
  ) {
    return {
      ok: false,
      reason: 'You cannot moderate someone with an equal or higher role.',
    };
  }

  // The bot must be strictly higher than the target to act.
  const me = guild.members.me;
  if (me && me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return {
      ok: false,
      reason:
        "My role is not high enough to act on this member. Move my role above theirs.",
    };
  }

  return OK;
}

/** Pretty-print a PermissionResolvable list to readable names. */
export function permissionNames(perms: PermissionResolvable[]): string[] {
  return new PermissionsBitField(perms).toArray();
}
