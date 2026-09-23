import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { GuildConfig } from '../../config/guildConfig.js';
import type { Ticket } from '../../database/repositories/ticketsRepo.js';

/**
 * PURE authorization core (unit-tested). A user is ticket-staff if they hold a
 * configured ticket-staff role OR have ManageGuild. Never trust a customId —
 * every action re-derives this from live member data server-side.
 */
export function isTicketStaff(
  memberRoleIds: string[],
  hasManageGuild: boolean,
  staffRoleIds: string[],
): boolean {
  if (hasManageGuild) return true;
  return memberRoleIds.some((id) => staffRoleIds.includes(id));
}

/** Live wrapper around isTicketStaff for a GuildMember. */
export function memberIsTicketStaff(member: GuildMember, cfg: GuildConfig): boolean {
  return isTicketStaff(
    [...member.roles.cache.keys()],
    member.permissions.has(PermissionFlagsBits.ManageGuild),
    cfg.ticketStaffRoleIds,
  );
}

export type TicketAction =
  | 'claim'
  | 'close'
  | 'add'
  | 'remove'
  | 'transfer'
  | 'transcript'
  | 'delete'
  | 'reopen';

/**
 * Authorization matrix. Staff can do everything; the opener may close their own
 * ticket and add members to it — but never claim/transfer/remove/delete, and
 * never grant staff/admin powers. Returns a reason string when denied.
 */
export function authorizeTicketAction(
  action: TicketAction,
  opts: { isStaff: boolean; isOpener: boolean },
): { ok: boolean; reason?: string } {
  const { isStaff, isOpener } = opts;
  switch (action) {
    case 'add':
    case 'close':
      if (isStaff || isOpener) return { ok: true };
      return { ok: false, reason: 'Only staff or the ticket creator can do that.' };
    case 'claim':
    case 'transfer':
    case 'remove':
    case 'transcript':
    case 'delete':
    case 'reopen':
      if (isStaff) return { ok: true };
      return { ok: false, reason: 'Only staff can do that.' };
    default:
      return { ok: false, reason: 'Unknown action.' };
  }
}

/**
 * Validates a ticket is safe to act on for an in-channel component: it exists,
 * belongs to this guild, and the button was pressed inside its own channel.
 * This is the "never trust the customId" gate.
 */
export function validateTicketContext(
  ticket: Ticket | null,
  guildId: string | null,
  channelId: string | null,
): { ok: boolean; reason?: string } {
  if (!ticket) return { ok: false, reason: 'This ticket no longer exists.' };
  if (!guildId || ticket.guildId !== guildId)
    return { ok: false, reason: 'This ticket does not belong to this server.' };
  if (channelId && ticket.channelId && ticket.channelId !== channelId)
    return { ok: false, reason: 'This control can only be used inside its own ticket channel.' };
  return { ok: true };
}
