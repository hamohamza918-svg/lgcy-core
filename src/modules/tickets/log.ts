import {
  EmbedBuilder,
  ChannelType,
  type Guild,
  type AttachmentBuilder,
} from 'discord.js';
import { getGuildConfig } from '../../config/guildConfig.js';
import { BRAND } from '../../config/constants.js';
import { scopedLogger } from '../../utils/logger.js';

const log = scopedLogger('tickets');

export type TicketEvent =
  | 'created'
  | 'claimed'
  | 'transferred'
  | 'member_added'
  | 'member_removed'
  | 'closed'
  | 'reopened'
  | 'transcript'
  | 'deleted';

const COLOR: Record<TicketEvent, number> = {
  created: BRAND.colorSuccess,
  claimed: BRAND.colorInfo,
  transferred: BRAND.colorInfo,
  member_added: BRAND.colorInfo,
  member_removed: BRAND.colorWarn,
  closed: BRAND.colorDanger,
  reopened: BRAND.colorSuccess,
  transcript: BRAND.colorNeutral,
  deleted: BRAND.colorDanger,
};

/**
 * Logs a ticket lifecycle event to the configured ticket log channel. Every
 * lifecycle action (create/claim/transfer/add/remove/close/reopen/transcript/
 * delete) routes through here so the audit trail is complete.
 */
export async function logTicketEvent(
  guild: Guild,
  event: TicketEvent,
  fields: { name: string; value: string; inline?: boolean }[],
  attachment?: AttachmentBuilder,
): Promise<void> {
  const cfg = getGuildConfig(guild.id);
  if (!cfg.ticketLogChannelId) return;
  try {
    const channel =
      guild.channels.cache.get(cfg.ticketLogChannelId) ??
      (await guild.channels.fetch(cfg.ticketLogChannelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) return;
    const embed = new EmbedBuilder()
      .setColor(COLOR[event])
      .setAuthor({ name: `Ticket ${event.replace('_', ' ')}` })
      .addFields(fields)
      .setTimestamp();
    await channel.send({ embeds: [embed], files: attachment ? [attachment] : [] });
  } catch (err) {
    log.error({ err, event }, 'failed to write ticket log');
  }
}
