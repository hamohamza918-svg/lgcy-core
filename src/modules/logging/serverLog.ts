import {
  Events, EmbedBuilder, AuditLogEvent, ChannelType,
  type Role,
} from 'discord.js';
import type { EventHandler } from '../../types/index.js';
import { sendLog } from '../../services/logService.js';
import { LOG_COLORS, withIds, fetchActor, byLine } from './shared.js';

const MODULE = 'logging';

const TYPE_LABEL: Partial<Record<ChannelType, string>> = {
  [ChannelType.GuildText]: 'Text',
  [ChannelType.GuildVoice]: 'Voice',
  [ChannelType.GuildCategory]: 'Category',
  [ChannelType.GuildAnnouncement]: 'Announcement',
  [ChannelType.GuildStageVoice]: 'Stage',
  [ChannelType.GuildForum]: 'Forum',
};
const typeLabel = (t: ChannelType): string => TYPE_LABEL[t] ?? 'Channel';

export const channelCreateLog: EventHandler<Events.ChannelCreate> = {
  name: Events.ChannelCreate, module: MODULE,
  async execute(_c, channel) {
    const actor = await fetchActor(channel.guild, AuditLogEvent.ChannelCreate, { targetId: channel.id, windowMs: 8000 });
    const e = new EmbedBuilder().setColor(LOG_COLORS.create)
      .setAuthor({ name: 'Channel created' })
      .setDescription(`<#${channel.id}> (\`${channel.name}\`) created ${byLine(actor)}`)
      .addFields({ name: 'Type', value: typeLabel(channel.type), inline: true })
      .setTimestamp();
    withIds(e, channel.guild.id, [['Channel', channel.id], ['By', actor?.id]]);
    await sendLog(channel.guild, 'server', e);
  },
};

export const channelDeleteLog: EventHandler<Events.ChannelDelete> = {
  name: Events.ChannelDelete, module: MODULE,
  async execute(_c, channel) {
    if (!('guild' in channel)) return;
    const actor = await fetchActor(channel.guild, AuditLogEvent.ChannelDelete, { targetId: channel.id, windowMs: 8000 });
    const e = new EmbedBuilder().setColor(LOG_COLORS.delete)
      .setAuthor({ name: 'Channel deleted' })
      .setDescription(`\`${channel.name}\` (${typeLabel(channel.type)}) deleted ${byLine(actor)}`)
      .setTimestamp();
    withIds(e, channel.guild.id, [['Channel', channel.id], ['By', actor?.id]]);
    await sendLog(channel.guild, 'server', e);
  },
};

export const channelUpdateLog: EventHandler<Events.ChannelUpdate> = {
  name: Events.ChannelUpdate, module: MODULE,
  async execute(_c, oldChannel, newChannel) {
    if (!('guild' in newChannel) || !('guild' in oldChannel)) return;
    const changes: string[] = [];
    if ('name' in oldChannel && 'name' in newChannel && oldChannel.name !== newChannel.name) {
      changes.push(`**Name:** \`${oldChannel.name}\` → \`${newChannel.name}\``);
    }
    const oldTopic = 'topic' in oldChannel ? oldChannel.topic ?? '' : '';
    const newTopic = 'topic' in newChannel ? newChannel.topic ?? '' : '';
    if (oldTopic !== newTopic) changes.push('**Topic** changed');
    if (!changes.length) return; // ignore perms-only/position-only churn here
    const actor = await fetchActor(newChannel.guild, AuditLogEvent.ChannelUpdate, { targetId: newChannel.id, windowMs: 8000 });
    const e = new EmbedBuilder().setColor(LOG_COLORS.update)
      .setAuthor({ name: 'Channel updated' })
      .setDescription(`<#${newChannel.id}> updated ${byLine(actor)}\n${changes.join('\n')}`)
      .setTimestamp();
    withIds(e, newChannel.guild.id, [['Channel', newChannel.id], ['By', actor?.id]]);
    await sendLog(newChannel.guild, 'server', e);
  },
};

export const roleCreateLog: EventHandler<Events.GuildRoleCreate> = {
  name: Events.GuildRoleCreate, module: MODULE,
  async execute(_c, role: Role) {
    const actor = await fetchActor(role.guild, AuditLogEvent.RoleCreate, { targetId: role.id, windowMs: 8000 });
    const e = new EmbedBuilder().setColor(LOG_COLORS.create)
      .setAuthor({ name: 'Role created' })
      .setDescription(`<@&${role.id}> (\`${role.name}\`) created ${byLine(actor)}`)
      .setTimestamp();
    withIds(e, role.guild.id, [['Role', role.id], ['By', actor?.id]]);
    await sendLog(role.guild, 'server', e);
  },
};

export const roleDeleteLog: EventHandler<Events.GuildRoleDelete> = {
  name: Events.GuildRoleDelete, module: MODULE,
  async execute(_c, role: Role) {
    const actor = await fetchActor(role.guild, AuditLogEvent.RoleDelete, { targetId: role.id, windowMs: 8000 });
    const e = new EmbedBuilder().setColor(LOG_COLORS.delete)
      .setAuthor({ name: 'Role deleted' })
      .setDescription(`\`${role.name}\` deleted ${byLine(actor)}`)
      .setTimestamp();
    withIds(e, role.guild.id, [['Role', role.id], ['By', actor?.id]]);
    await sendLog(role.guild, 'server', e);
  },
};
