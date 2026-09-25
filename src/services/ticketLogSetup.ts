import { ChannelType, PermissionFlagsBits, type Guild } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { getGuildConfig, updateGuildConfig } from '../config/guildConfig.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('ticket-log-setup');
const STAFF_CATEGORY = '1534981671743651900'; // ━ LGCY · STAFF ━
const CHANNEL_NAME = 'ticket-logs';

/**
 * One-time: when TICKET_LOG_CREATE=1, create a dedicated staff-only #ticket-logs
 * channel for transcripts and set ticketLogChannelId to it. Idempotent (reuses an
 * existing #ticket-logs). Logs the resulting channel id so it can be pinned as an
 * env var (TICKET_LOG_CHANNEL_ID) for persistence, then the flag is removed.
 */
export async function maybeCreateTicketLog(guild: Guild): Promise<void> {
  if (loadEnv().TICKET_LOG_CREATE !== '1') return;
  const cfg = getGuildConfig(guild.id);
  if (cfg.ticketLogChannelId) {
    log.info({ ticketLogChannelId: cfg.ticketLogChannelId }, 'ticket log already configured — skipping');
    return;
  }
  await guild.channels.fetch();
  const me = guild.members.me;
  const staff = cfg.ticketStaffRoleIds;
  try {
    let ch = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME) as import('discord.js').TextChannel | undefined;
    if (!ch) {
      ch = await guild.channels.create({
        name: CHANNEL_NAME,
        type: ChannelType.GuildText,
        parent: STAFF_CATEGORY,
        topic: 'Ticket transcripts & lifecycle log — one entry per ticket',
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          ...(me ? [{ id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ReadMessageHistory] }] : []),
          ...staff.map((rid) => ({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] })),
        ],
      });
      log.info({ channel: ch.id }, 'created #ticket-logs channel');
    }
    updateGuildConfig(guild.id, (d) => { d.ticketLogChannelId = ch!.id; });
    log.info({ ticketLogChannelId: ch.id }, `TICKET_LOG_READY id=${ch.id} — set TICKET_LOG_CHANNEL_ID env to this + remove TICKET_LOG_CREATE`);
  } catch (err) {
    log.error({ err: (err as Error).message }, 'failed to create ticket-logs channel');
  }
}
