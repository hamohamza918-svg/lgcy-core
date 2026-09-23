import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildMember,
  type TextChannel,
  type OverwriteResolvable,
} from 'discord.js';
import type { GuildConfig, TicketCategory } from '../../config/guildConfig.js';
import { ticketsRepo, type Ticket } from '../../database/repositories/ticketsRepo.js';
import { buildChannelName } from './naming.js';
import { buildTicketEmbed, buildControlRows } from './ui.js';
import { scopedLogger } from '../../utils/logger.js';

const log = scopedLogger('tickets');

/** Permissions granted to the bot on a ticket channel — only what it needs. */
const BOT_TICKET_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];

/** Builds the initial permission overwrites for a new ticket channel. */
function buildOverwrites(
  guild: Guild,
  openerId: string,
  cfg: GuildConfig,
): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    // @everyone cannot even see the channel.
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    // Creator: view, send, attach, read history.
    {
      id: openerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    },
  ];

  // Configured staff roles: view, send, manage the ticket.
  for (const roleId of cfg.ticketStaffRoleIds) {
    if (!guild.roles.cache.has(roleId)) continue;
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    });
  }

  // The bot itself — only the permissions required to operate the ticket.
  if (guild.members.me) {
    overwrites.push({ id: guild.members.me.id, allow: BOT_TICKET_PERMS });
  }

  return overwrites;
}

export interface CreateResult {
  ticket: Ticket;
  channel: TextChannel;
}

/**
 * Creates a ticket: persists the row first (so the number is durable and unique
 * even if channel creation fails), then creates the private channel and posts
 * the metadata embed + controls.
 */
export async function createTicket(
  guild: Guild,
  opener: GuildMember,
  cfg: GuildConfig,
  category: TicketCategory,
  subject: string,
  description: string,
): Promise<CreateResult> {
  const parentId = cfg.ticketParentCategoryId;
  const parent = parentId ? guild.channels.cache.get(parentId) : null;
  if (!parent || parent.type !== ChannelType.GuildCategory) {
    throw new Error('The ticket system is not configured (no parent category set).');
  }

  const ticket = ticketsRepo.create({
    guildId: guild.id,
    openerId: opener.id,
    category: category.key,
    subject,
    description,
  });

  try {
    const existing = new Set(guild.channels.cache.map((c) => c.name));
    const name = buildChannelName(category.channelPrefix, opener.user.username, existing, ticket.ticketNumber);

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parent.id,
      topic: `Ticket #${ticket.ticketNumber} • ${category.label} • opened by ${opener.user.tag}`,
      permissionOverwrites: buildOverwrites(guild, opener.id, cfg),
      reason: `Ticket #${ticket.ticketNumber} created by ${opener.user.tag}`,
    });

    ticketsRepo.setChannel(ticket.id, channel.id);
    const stored = ticketsRepo.getById(ticket.id)!;

    const staffMention = cfg.ticketStaffRoleIds.map((r) => `<@&${r}>`).join(' ');
    await channel.send({
      content: `<@${opener.id}> ${staffMention}`.trim(),
      embeds: [buildTicketEmbed(stored, { categoryLabel: category.label })],
      components: buildControlRows(ticket.id, false),
    });

    return { ticket: stored, channel };
  } catch (err) {
    // Roll back the row so a failed creation doesn't leave a ghost ticket.
    ticketsRepo.delete(ticket.id);
    log.error({ err, ticketId: ticket.id }, 'ticket channel creation failed — rolled back');
    throw new Error('I could not create the ticket channel. Check my permissions and the parent category.');
  }
}

/** Applies the CLOSED state to a channel: revoke opener send, optionally archive. */
export async function applyClosedChannelState(
  channel: TextChannel,
  ticket: Ticket,
  cfg: GuildConfig,
): Promise<void> {
  // Stop normal member messaging (opener can still read).
  await channel.permissionOverwrites
    .edit(ticket.openerId, { SendMessages: false })
    .catch((err) => log.warn({ err }, 'failed to revoke opener send on close'));

  if (cfg.ticketArchiveCategoryId && channel.guild.channels.cache.has(cfg.ticketArchiveCategoryId)) {
    await channel
      .setParent(cfg.ticketArchiveCategoryId, { lockPermissions: false, reason: 'Ticket closed — archived' })
      .catch((err) => log.warn({ err }, 'failed to move ticket to archive'));
  }
}

/** Grants a user access to a ticket channel (this ticket only — no roles/admin). */
export async function addMemberAccess(channel: TextChannel, userId: string): Promise<void> {
  await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true,
    ReadMessageHistory: true,
  });
}

/** Removes a user's access to a ticket channel. */
export async function removeMemberAccess(channel: TextChannel, userId: string): Promise<void> {
  await channel.permissionOverwrites.delete(userId).catch(() => {
    /* no overwrite existed */
  });
}
