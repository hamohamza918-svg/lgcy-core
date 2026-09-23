import {
  Events,
  EmbedBuilder,
  time,
  TimestampStyles,
  type GuildMember,
  type PartialGuildMember,
  type Message,
  type PartialMessage,
  type VoiceState,
  type GuildBan,
} from 'discord.js';
import type { EventHandler } from '../../types/index.js';
import { sendLog } from '../../services/logService.js';
import { BRAND } from '../../config/constants.js';

const MODULE = 'logging';

function trim(text: string | null | undefined, max = 1024): string {
  if (!text) return '*empty*';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

const memberJoinLog: EventHandler<Events.GuildMemberAdd> = {
  name: Events.GuildMemberAdd,
  module: MODULE,
  async execute(_c, member: GuildMember) {
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorSuccess)
      .setAuthor({ name: `${member.user.tag} joined`, iconURL: member.user.displayAvatarURL() })
      .addFields(
        { name: 'User', value: `<@${member.id}> (${member.id})` },
        { name: 'Account created', value: time(member.user.createdAt, TimestampStyles.RelativeTime), inline: true },
        { name: 'Member count', value: String(member.guild.memberCount), inline: true },
        { name: 'Type', value: member.user.bot ? '🤖 Bot' : '👤 Member', inline: true },
      )
      .setTimestamp();
    await sendLog(member.guild, 'member', embed);
  },
};

const memberLeaveLog: EventHandler<Events.GuildMemberRemove> = {
  name: Events.GuildMemberRemove,
  module: MODULE,
  async execute(_c, member: GuildMember | PartialGuildMember) {
    const roles = member.roles?.cache
      ?.filter((r) => r.id !== member.guild.id)
      .map((r) => `<@&${r.id}>`)
      .join(' ');
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorNeutral)
      .setAuthor({ name: `${member.user?.tag ?? 'Unknown'} left`, iconURL: member.user?.displayAvatarURL() })
      .addFields(
        { name: 'User', value: `<@${member.id}> (${member.id})` },
        { name: 'Roles', value: roles && roles.length > 0 ? trim(roles) : '*none*' },
      )
      .setTimestamp();
    await sendLog(member.guild, 'member', embed);
  },
};

const messageDeleteLog: EventHandler<Events.MessageDelete> = {
  name: Events.MessageDelete,
  module: MODULE,
  async execute(_c, message: Message | PartialMessage) {
    if (!message.guild) return;
    if (message.author?.bot) return;
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorDanger)
      .setAuthor({
        name: `Message deleted in #${'name' in message.channel ? message.channel.name : 'channel'}`,
      })
      .addFields(
        { name: 'Author', value: message.author ? `<@${message.author.id}>` : '*unknown*', inline: true },
        { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
        { name: 'Content', value: trim(message.content) },
      )
      .setTimestamp();
    await sendLog(message.guild, 'message', embed);
  },
};

const messageEditLog: EventHandler<Events.MessageUpdate> = {
  name: Events.MessageUpdate,
  module: MODULE,
  async execute(_c, oldMessage, newMessage) {
    const msg = newMessage as Message | PartialMessage;
    if (!msg.guild) return;
    if (msg.author?.bot) return;
    if (oldMessage.content === newMessage.content) return; // ignore embed-only updates
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorWarn)
      .setAuthor({ name: 'Message edited' })
      .addFields(
        { name: 'Author', value: msg.author ? `<@${msg.author.id}>` : '*unknown*', inline: true },
        { name: 'Channel', value: `<#${msg.channelId}>`, inline: true },
        { name: 'Before', value: trim(oldMessage.content) },
        { name: 'After', value: trim(newMessage.content) },
      )
      .setURL(msg.url ?? null)
      .setTimestamp();
    await sendLog(msg.guild, 'message', embed);
  },
};

const memberUpdateLog: EventHandler<Events.GuildMemberUpdate> = {
  name: Events.GuildMemberUpdate,
  module: MODULE,
  async execute(_c, oldMember, newMember) {
    const guild = newMember.guild;

    // Nickname change
    if (oldMember.nickname !== newMember.nickname) {
      const embed = new EmbedBuilder()
        .setColor(BRAND.colorInfo)
        .setAuthor({ name: `${newMember.user.tag} — nickname changed`, iconURL: newMember.user.displayAvatarURL() })
        .addFields(
          { name: 'Before', value: oldMember.nickname ?? '*none*', inline: true },
          { name: 'After', value: newMember.nickname ?? '*none*', inline: true },
        )
        .setTimestamp();
      await sendLog(guild, 'role', embed);
    }

    // Role changes
    const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
    if (added.size > 0 || removed.size > 0) {
      const embed = new EmbedBuilder()
        .setColor(BRAND.colorInfo)
        .setAuthor({ name: `${newMember.user.tag} — roles updated`, iconURL: newMember.user.displayAvatarURL() });
      if (added.size) embed.addFields({ name: '➕ Added', value: added.map((r) => `<@&${r.id}>`).join(' ') });
      if (removed.size) embed.addFields({ name: '➖ Removed', value: removed.map((r) => `<@&${r.id}>`).join(' ') });
      embed.setTimestamp();
      await sendLog(guild, 'role', embed);
    }
  },
};

const banLog: EventHandler<Events.GuildBanAdd> = {
  name: Events.GuildBanAdd,
  module: MODULE,
  async execute(_c, ban: GuildBan) {
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorDanger)
      .setAuthor({ name: `${ban.user.tag} was banned`, iconURL: ban.user.displayAvatarURL() })
      .addFields({ name: 'User', value: `<@${ban.user.id}> (${ban.user.id})` })
      .setTimestamp();
    await sendLog(ban.guild, 'moderation', embed);
  },
};

const unbanLog: EventHandler<Events.GuildBanRemove> = {
  name: Events.GuildBanRemove,
  module: MODULE,
  async execute(_c, ban: GuildBan) {
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorSuccess)
      .setAuthor({ name: `${ban.user.tag} was unbanned`, iconURL: ban.user.displayAvatarURL() })
      .addFields({ name: 'User', value: `<@${ban.user.id}> (${ban.user.id})` })
      .setTimestamp();
    await sendLog(ban.guild, 'moderation', embed);
  },
};

const voiceLog: EventHandler<Events.VoiceStateUpdate> = {
  name: Events.VoiceStateUpdate,
  module: MODULE,
  async execute(_c, oldState: VoiceState, newState: VoiceState) {
    const guild = newState.guild;
    const user = newState.member?.user ?? oldState.member?.user;
    if (!user) return;
    let description: string | null = null;
    let color: number = BRAND.colorInfo;

    if (!oldState.channelId && newState.channelId) {
      description = `➡️ Joined voice <#${newState.channelId}>`;
      color = BRAND.colorSuccess;
    } else if (oldState.channelId && !newState.channelId) {
      description = `⬅️ Left voice <#${oldState.channelId}>`;
      color = BRAND.colorNeutral;
    } else if (oldState.channelId !== newState.channelId) {
      description = `🔀 Moved <#${oldState.channelId}> → <#${newState.channelId}>`;
    }
    if (!description) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setDescription(description)
      .setTimestamp();
    await sendLog(guild, 'voice', embed);
  },
};

const channelCreateLog: EventHandler<Events.ChannelCreate> = {
  name: Events.ChannelCreate,
  module: MODULE,
  async execute(_c, channel) {
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorSuccess)
      .setAuthor({ name: 'Channel created' })
      .setDescription(`<#${channel.id}> (\`${channel.name}\`)`)
      .setTimestamp();
    await sendLog(channel.guild, 'server', embed);
  },
};

const channelDeleteLog: EventHandler<Events.ChannelDelete> = {
  name: Events.ChannelDelete,
  module: MODULE,
  async execute(_c, channel) {
    if (!('guild' in channel)) return;
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorDanger)
      .setAuthor({ name: 'Channel deleted' })
      .setDescription(`\`${channel.name}\` (${channel.id})`)
      .setTimestamp();
    await sendLog(channel.guild, 'server', embed);
  },
};

export const loggingEvents: EventHandler[] = [
  memberJoinLog,
  memberLeaveLog,
  messageDeleteLog,
  messageEditLog,
  memberUpdateLog,
  banLog,
  unbanLog,
  voiceLog,
  channelCreateLog,
  channelDeleteLog,
] as EventHandler[];
