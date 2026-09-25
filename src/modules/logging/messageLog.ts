import {
  Events, EmbedBuilder, AuditLogEvent,
  type Message, type PartialMessage,
} from 'discord.js';
import type { EventHandler } from '../../types/index.js';
import { sendLog } from '../../services/logService.js';
import { getGuildConfig } from '../../config/guildConfig.js';
import { LOG_COLORS, trim, withIds, fetchActor, actorSuffix } from './shared.js';

const MODULE = 'logging';
const chanName = (m: { channel: unknown }) => (m.channel && typeof m.channel === 'object' && 'name' in m.channel ? String((m.channel as { name?: string }).name) : 'channel');

/** High-volume: logs every human message sent. Off unless logging.logMessageSends. */
export const messageCreateLog: EventHandler<Events.MessageCreate> = {
  name: Events.MessageCreate, module: MODULE,
  async execute(_c, message) {
    if (!message.guild || message.author?.bot || !message.author) return;
    if (!getGuildConfig(message.guild.id).logging.logMessageSends) return;
    if (!message.content && message.attachments.size === 0) return; // nothing to log
    const e = new EmbedBuilder()
      .setColor(LOG_COLORS.neutral)
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
      .setDescription(message.content ? trim(message.content, 2000) : '*no text*')
      .addFields({ name: 'Channel', value: `<#${message.channelId}>`, inline: true });
    if (message.attachments.size) e.addFields({ name: 'Attachments', value: String(message.attachments.size), inline: true });
    e.setURL(message.url).setTimestamp();
    withIds(e, message.guild.id, [['Author', message.author.id], ['Msg', message.id]]);
    await sendLog(message.guild, 'message', e);
  },
};

export const messageDeleteLog: EventHandler<Events.MessageDelete> = {
  name: Events.MessageDelete, module: MODULE,
  async execute(_c, message: Message | PartialMessage) {
    if (!message.guild || message.author?.bot) return;
    const author = message.author;
    // Who deleted it? A MessageDelete audit entry exists only when a MOD deletes
    // someone else's message (self-deletes produce none) → attribute or omit.
    const actor = author ? await fetchActor(message.guild, AuditLogEvent.MessageDelete, { targetId: author.id, windowMs: 6000 }) : null;
    const e = new EmbedBuilder()
      .setColor(LOG_COLORS.delete)
      .setAuthor({ name: `Message deleted in #${chanName(message)}`, iconURL: author?.displayAvatarURL() })
      .addFields(
        { name: 'Author', value: author ? `<@${author.id}>` : '*unknown*', inline: true },
        { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
        { name: 'Content', value: trim(message.content) },
      )
      .setTimestamp();
    if (actor) e.setDescription(`Deleted ${actorSuffix(actor)}`);
    if (message.attachments.size) e.addFields({ name: 'Attachments', value: String(message.attachments.size), inline: true });
    withIds(e, message.guild.id, [['Author', author?.id], ['Msg', message.id], ['Mod', actor?.id]]);
    await sendLog(message.guild, 'message', e);
  },
};

export const messageEditLog: EventHandler<Events.MessageUpdate> = {
  name: Events.MessageUpdate, module: MODULE,
  async execute(_c, oldMessage, newMessage) {
    const msg = newMessage as Message | PartialMessage;
    if (!msg.guild || msg.author?.bot) return;
    if (oldMessage.content === newMessage.content) return; // embed-only update
    const e = new EmbedBuilder()
      .setColor(LOG_COLORS.update)
      .setAuthor({ name: `${msg.author?.tag ?? 'Message'} edited a message`, iconURL: msg.author?.displayAvatarURL() })
      .addFields(
        { name: 'Author', value: msg.author ? `<@${msg.author.id}>` : '*unknown*', inline: true },
        { name: 'Channel', value: `<#${msg.channelId}>`, inline: true },
        { name: 'Before', value: trim(oldMessage.content) },
        { name: 'After', value: trim(newMessage.content) },
      )
      .setURL(msg.url ?? null)
      .setTimestamp();
    withIds(e, msg.guild.id, [['Author', msg.author?.id], ['Msg', msg.id]]);
    await sendLog(msg.guild, 'message', e);
  },
};

export const messageBulkDeleteLog: EventHandler<Events.MessageBulkDelete> = {
  name: Events.MessageBulkDelete, module: MODULE,
  async execute(_c, messages, channel) {
    if (!('guild' in channel) || !channel.guild) return;
    const actor = await fetchActor(channel.guild, AuditLogEvent.MessageBulkDelete, { windowMs: 8000 });
    const e = new EmbedBuilder()
      .setColor(LOG_COLORS.delete)
      .setAuthor({ name: `Bulk message delete in #${'name' in channel ? channel.name : 'channel'}` })
      .setDescription(actor ? `Purged ${actorSuffix(actor)}` : null)
      .addFields(
        { name: 'Channel', value: `<#${channel.id}>`, inline: true },
        { name: 'Messages deleted', value: String(messages.size), inline: true },
      )
      .setTimestamp();
    withIds(e, channel.guild.id, [['Channel', channel.id], ['Mod', actor?.id]]);
    await sendLog(channel.guild, 'message', e);
  },
};
