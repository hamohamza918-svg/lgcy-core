import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildChannel,
} from 'discord.js';
import { loadEnv } from '../config/env.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('grant-channels');

const LGCY_ROLE_ID = '1551612525336858747';
const POST = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
];
const TEXTLIKE = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/**
 * One-time bootstrap: when GRANT_CHANNELS=1, ensure the LGCY Core role has an
 * explicit View/Send/Embed/Attach overwrite on every non-private text channel.
 * Meant to run once while the bot temporarily holds Administrator (so it can see
 * private staff/log channels it otherwise couldn't). Adds ONLY the bot's own
 * overwrite; never touches @everyone/Muted/staff overwrites; skips "private".
 * After it runs, remove GRANT_CHANNELS and the Administrator permission — the
 * per-channel overwrites persist.
 */
export async function maybeGrantChannels(guild: Guild): Promise<void> {
  if (loadEnv().GRANT_CHANNELS !== '1') return;
  log.info('GRANT_CHANNELS=1 — ensuring LGCY Core post overwrites on non-private channels');
  await guild.channels.fetch();

  let granted = 0, alreadyOk = 0, skipped = 0, failed = 0;
  for (const ch of guild.channels.cache.values()) {
    if (!ch || !TEXTLIKE.has(ch.type)) continue;
    const gch = ch as GuildChannel;
    if (/private/i.test(gch.name) || /private/i.test(gch.parent?.name ?? '')) { skipped++; continue; }
    const ow = gch.permissionOverwrites.cache.get(LGCY_ROLE_ID);
    if (ow && POST.every((f) => ow.allow.has(f))) { alreadyOk++; continue; }
    try {
      await gch.permissionOverwrites.edit(LGCY_ROLE_ID, {
        ViewChannel: true, SendMessages: true, EmbedLinks: true, AttachFiles: true,
      });
      granted++;
      log.info({ channel: gch.name }, 'granted post access');
    } catch (err) {
      failed++;
      log.warn({ channel: gch.name, err: (err as Error).message }, 'grant failed');
    }
  }
  log.info(
    { granted, alreadyOk, skipped, failed },
    'channel grant complete — now remove GRANT_CHANNELS env var and turn OFF Administrator',
  );
}
