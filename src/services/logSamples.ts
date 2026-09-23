import { EmbedBuilder, type Guild } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { sendLog } from './logService.js';
import { scopedLogger } from '../utils/logger.js';
import { LOG_COLORS, tBoth, tDate, secOf } from '../modules/logging/shared.js';
import { renderSessionSummaryEmbed } from '../modules/logging/voiceLog.js';

const log = scopedLogger('log-samples');
const SAMPLE = { text: '🧪 Sample log — this is a preview of how this channel will look. Safe to delete.' };

/**
 * One-time: when LOG_TEST=1, posts a representative sample embed to each
 * configured log channel so the layout can be reviewed live. Marked clearly as a
 * sample. Remove LOG_TEST after running. No real events are affected.
 */
export async function maybePostLogSamples(guild: Guild): Promise<void> {
  if (loadEnv().LOG_TEST !== '1') return;
  log.info('LOG_TEST=1 — posting sample embeds to each configured log channel');
  const now = secOf(Date.now());

  const member = new EmbedBuilder().setColor(LOG_COLORS.create)
    .setAuthor({ name: 'sample_user joined' })
    .setDescription('⚠️ **New account** — created recently, worth a look.')
    .addFields(
      { name: 'User', value: 'sample_user', inline: true },
      { name: 'Account created', value: tDate(now - 3 * 86400), inline: true },
      { name: 'Member #', value: '33', inline: true },
    ).setFooter(SAMPLE).setTimestamp();

  const message = new EmbedBuilder().setColor(LOG_COLORS.delete)
    .setAuthor({ name: 'Message deleted in #general' })
    .setDescription('Deleted by **GhostAdmin**')
    .addFields(
      { name: 'Author', value: 'sample_user', inline: true },
      { name: 'Channel', value: '#general', inline: true },
      { name: 'Content', value: 'check this out lol' },
    ).setFooter(SAMPLE).setTimestamp();

  const role = new EmbedBuilder().setColor(LOG_COLORS.update)
    .setAuthor({ name: 'sample_user — roles updated' })
    .setDescription('Updated by **GhostAdmin**')
    .addFields({ name: '➕ Added', value: '@VIP' }, { name: '➖ Removed', value: '@Member' })
    .setFooter(SAMPLE).setTimestamp();

  const moderation = new EmbedBuilder().setColor(LOG_COLORS.mod)
    .setAuthor({ name: 'sample_user was timed out' })
    .setDescription('**sample_user** was timed out by **GhostAdmin** · mic spam')
    .addFields({ name: 'Until', value: tBoth(now + 3600), inline: true })
    .setFooter(SAMPLE).setTimestamp();

  const server = new EmbedBuilder().setColor(LOG_COLORS.create)
    .setAuthor({ name: 'Channel created' })
    .setDescription('#new-lounge (`new-lounge`) created by **GhostAdmin**')
    .addFields({ name: 'Type', value: 'Text', inline: true })
    .setFooter(SAMPLE).setTimestamp();

  const voice = renderSessionSummaryEmbed({
    username: 'sample_user', channelId: '0', userId: '0',
    routeNames: ['LGCY 3', 'LGCY 2', 'LGCY 3'], sessionDurationMs: 2_720_000, moveCount: 2, peakChannelSize: 6,
    joinedAtSec: now - 2720, leftAtSec: now, includeIds: false, showCounts: true, showDuration: true,
  }).setFooter(SAMPLE);

  const jobs: [Parameters<typeof sendLog>[1], EmbedBuilder][] = [
    ['member', member], ['message', message], ['role', role],
    ['moderation', moderation], ['server', server], ['voice', voice],
  ];
  for (const [category, embed] of jobs) {
    try { await sendLog(guild, category, embed); }
    catch (err) { log.warn({ category, err: (err as Error).message }, 'sample failed'); }
  }
  log.info('sample logs posted — remove the LOG_TEST env var now');
}
