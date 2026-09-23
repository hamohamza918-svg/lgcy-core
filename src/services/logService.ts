import { type Guild, type EmbedBuilder, ChannelType } from 'discord.js';
import { getGuildConfig, type LogChannels } from '../config/guildConfig.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('log-service');

export type LogCategory = keyof LogChannels;

/**
 * Sends a log embed to the channel configured for a given category. Categories
 * can each point at a different channel so one giant channel is never spammed;
 * if a category has no channel configured, the log is silently skipped.
 */
export async function sendLog(
  guild: Guild,
  category: LogCategory,
  embed: EmbedBuilder,
): Promise<void> {
  const cfg = getGuildConfig(guild.id);
  await sendLogToChannel(guild, cfg.logChannels[category], embed);
}

/**
 * Sends a log embed to an explicit channel id (used when a feature routes to its
 * own destination, e.g. the detailed voice-state debug channel). No-ops when the
 * channel id is unset/missing so callers never need to null-check.
 */
export async function sendLogToChannel(
  guild: Guild,
  channelId: string | undefined | null,
  embed: EmbedBuilder,
): Promise<void> {
  if (!channelId) return;
  try {
    const channel =
      guild.channels.cache.get(channelId) ??
      (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) {
      log.warn({ guildId: guild.id, channelId }, 'log channel missing or not text');
      return;
    }
    // Respect rate limits: discord.js queues sends; we just fire-and-log errors.
    await channel.send({ embeds: [embed] });
  } catch (err) {
    log.error({ err, guildId: guild.id, channelId }, 'failed to send log');
  }
}
