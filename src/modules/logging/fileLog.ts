import {
  Events, EmbedBuilder, AttachmentBuilder, ChannelType, AuditLogEvent,
  type Message, type PartialMessage, type Guild,
} from 'discord.js';
import type { EventHandler } from '../../types/index.js';
import { getGuildConfig } from '../../config/guildConfig.js';
import { LOG_COLORS, withIds, fetchActor, actorSuffix } from './shared.js';
import { scopedLogger } from '../../utils/logger.js';

const MODULE = 'logging';
const log = scopedLogger('file-log');
const MAX_REHOST = 8 * 1024 * 1024; // 8MB — re-upload smaller files, link larger
const humanSize = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);

async function resolveText(guild: Guild, id: string | undefined) {
  if (!id) return null;
  const ch = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
  return ch && ch.type === ChannelType.GuildText ? ch : null;
}

/** file-log-01: re-hosts every uploaded attachment so it survives deletion. */
export const fileCreateLog: EventHandler<Events.MessageCreate> = {
  name: Events.MessageCreate, module: MODULE,
  async execute(_c, message) {
    if (!message.guild || message.author?.bot || message.attachments.size === 0) return;
    const cfg = getGuildConfig(message.guild.id);
    const channel = await resolveText(message.guild, cfg.fileLog.postedChannelId);
    if (!channel) return;

    const atts = [...message.attachments.values()];
    const files: AttachmentBuilder[] = [];
    const lines: string[] = [];
    for (const a of atts.slice(0, 10)) {
      lines.push(`• \`${a.name ?? 'file'}\` — ${humanSize(a.size)}${a.size > MAX_REHOST ? ` · [link](${a.url})` : ''}`);
      if (a.size <= MAX_REHOST) files.push(new AttachmentBuilder(a.url, { name: a.name ?? 'file' }));
    }
    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.neutral)
      .setAuthor({ name: `${message.author!.tag} uploaded ${atts.length} file(s)`, iconURL: message.author!.displayAvatarURL() })
      .setDescription(lines.join('\n'))
      .addFields({ name: 'Channel', value: `<#${message.channelId}>`, inline: true })
      .setURL(message.url)
      .setTimestamp();
    withIds(embed, message.guild.id, [['Author', message.author!.id], ['Msg', message.id]]);
    try {
      await channel.send({ embeds: [embed], files });
    } catch (err) {
      // Re-host failed (too large / fetch error) — post the record without files.
      log.debug({ err: (err as Error).message }, 're-host failed, logging metadata only');
      await channel.send({ embeds: [embed] }).catch(() => undefined);
    }
  },
};

/** file-log-02: records attachments that were deleted (+ who deleted). */
export const fileDeleteLog: EventHandler<Events.MessageDelete> = {
  name: Events.MessageDelete, module: MODULE,
  async execute(_c, message: Message | PartialMessage) {
    if (!message.guild || message.author?.bot || message.attachments.size === 0) return;
    const cfg = getGuildConfig(message.guild.id);
    const channel = await resolveText(message.guild, cfg.fileLog.deletedChannelId);
    if (!channel) return;

    const actor = message.author ? await fetchActor(message.guild, AuditLogEvent.MessageDelete, { targetId: message.author.id, windowMs: 6000 }) : null;
    const names = [...message.attachments.values()].map((a) => `• \`${a.name ?? 'file'}\` — ${humanSize(a.size)}`).join('\n');
    const embed = new EmbedBuilder()
      .setColor(LOG_COLORS.delete)
      .setAuthor({ name: `${message.author?.tag ?? 'Someone'}'s attachment(s) deleted`, iconURL: message.author?.displayAvatarURL() })
      .setDescription(actor ? `Deleted ${actorSuffix(actor)}` : null)
      .addFields(
        { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
        { name: 'Files', value: names },
      )
      .setTimestamp();
    if (cfg.fileLog.postedChannelId) embed.addFields({ name: 'Preserved copy', value: `<#${cfg.fileLog.postedChannelId}>`, inline: true });
    withIds(embed, message.guild.id, [['Author', message.author?.id], ['Msg', message.id], ['Mod', actor?.id]]);
    await channel.send({ embeds: [embed] }).catch(() => undefined);
  },
};
