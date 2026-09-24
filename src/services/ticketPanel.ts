import { ChannelType, type Guild } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { buildPanelEmbed, buildPanelSelect } from '../modules/tickets/ui.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('ticket-panel');

/**
 * One-time: when TICKET_PANEL_POST=1, post the ticket panel (select menu) to the
 * configured panel channel. Requires ticketPanelChannelId + ticketParentCategoryId
 * to be set. Remove the flag after running so it doesn't repost on every boot.
 */
export async function maybePostTicketPanel(guild: Guild): Promise<void> {
  if (loadEnv().TICKET_PANEL_POST !== '1') return;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.ticketPanelChannelId || !cfg.ticketParentCategoryId) {
    log.warn('TICKET_PANEL_POST set but panel channel / parent category not configured — skipping');
    return;
  }
  const ch = guild.channels.cache.get(cfg.ticketPanelChannelId)
    ?? (await guild.channels.fetch(cfg.ticketPanelChannelId).catch(() => null));
  if (!ch || ch.type !== ChannelType.GuildText) {
    log.warn({ channelId: cfg.ticketPanelChannelId }, 'ticket panel channel missing or not text');
    return;
  }
  try {
    await ch.send({ embeds: [buildPanelEmbed()], components: [buildPanelSelect(cfg)] });
    log.info({ channel: ch.id }, 'ticket panel posted — remove TICKET_PANEL_POST env var now');
  } catch (err) {
    log.error({ err: (err as Error).message }, 'failed to post ticket panel');
  }
}
