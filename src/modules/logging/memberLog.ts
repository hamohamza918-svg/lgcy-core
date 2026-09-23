import {
  Events, EmbedBuilder, AuditLogEvent,
  type GuildMember, type PartialGuildMember, type GuildBan,
} from 'discord.js';
import type { EventHandler } from '../../types/index.js';
import { sendLog } from '../../services/logService.js';
import { LOG_COLORS, tBoth, tDate, secOf, trim, withIds, fetchActor, actorSuffix, type Actor } from './shared.js';

const MODULE = 'logging';
const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000;
const modLine = (subject: string, verb: string, actor: Actor | null, fallbackReason?: string | null): string => {
  const who = actor ? `by **${actor.tag}**` : 'by an unknown moderator';
  const reason = actor?.reason ?? fallbackReason ?? null;
  return `**${subject}** was ${verb} ${who}${reason ? ` · ${reason}` : ''}`;
};

export const memberJoinLog: EventHandler<Events.GuildMemberAdd> = {
  name: Events.GuildMemberAdd, module: MODULE,
  async execute(_c, member: GuildMember) {
    const u = member.user;
    const isNew = Date.now() - u.createdTimestamp < NEW_ACCOUNT_MS;
    const e = new EmbedBuilder()
      .setColor(LOG_COLORS.create)
      .setAuthor({ name: `${u.tag} joined`, iconURL: u.displayAvatarURL() })
      .setThumbnail(u.displayAvatarURL())
      .addFields(
        { name: 'User', value: `<@${u.id}>`, inline: true },
        { name: 'Account created', value: tDate(secOf(u.createdAt)), inline: true },
        { name: 'Member #', value: String(member.guild.memberCount), inline: true },
      )
      .setTimestamp();
    if (u.bot) e.setDescription('🤖 This is a bot account.');
    else if (isNew) e.setDescription('⚠️ **New account** — created recently, worth a look.');
    withIds(e, member.guild.id, [['User', u.id]]);
    await sendLog(member.guild, 'member', e);
  },
};

export const memberLeaveLog: EventHandler<Events.GuildMemberRemove> = {
  name: Events.GuildMemberRemove, module: MODULE,
  async execute(_c, member: GuildMember | PartialGuildMember) {
    const guild = member.guild;
    const u = member.user;
    if (!u) return;
    const now = Date.now();

    // Kicked? → moderation embed with attribution.
    const kick = await fetchActor(guild, AuditLogEvent.MemberKick, { targetId: u.id, windowMs: 6000, now });
    if (kick) {
      const e = new EmbedBuilder().setColor(LOG_COLORS.mod)
        .setAuthor({ name: `${u.tag} was kicked`, iconURL: u.displayAvatarURL() })
        .setDescription(modLine(u.tag, 'kicked', kick))
        .addFields(
          { name: 'User', value: `<@${u.id}>`, inline: true },
          { name: 'Members', value: String(guild.memberCount), inline: true },
        )
        .setTimestamp();
      withIds(e, guild.id, [['User', u.id], ['Mod', kick.id]]);
      await sendLog(guild, 'moderation', e);
      return;
    }
    // Banned? The ban log covers it — avoid a duplicate "left".
    const banned = await fetchActor(guild, AuditLogEvent.MemberBanAdd, { targetId: u.id, windowMs: 6000, now });
    if (banned) return;

    // Normal leave.
    const roles = member.roles?.cache?.filter((r) => r.id !== guild.id).map((r) => `<@&${r.id}>`).join(' ');
    const e = new EmbedBuilder().setColor(LOG_COLORS.delete)
      .setAuthor({ name: `${u.tag} left`, iconURL: u.displayAvatarURL() })
      .addFields(
        { name: 'User', value: `<@${u.id}>`, inline: true },
        { name: 'Members', value: String(guild.memberCount), inline: true },
      );
    if (member.joinedTimestamp) e.addFields({ name: 'Joined server', value: tDate(secOf(member.joinedTimestamp)), inline: false });
    e.addFields({ name: 'Roles', value: roles && roles.length ? trim(roles) : '*none*' }).setTimestamp();
    withIds(e, guild.id, [['User', u.id]]);
    await sendLog(guild, 'member', e);
  },
};

export const memberUpdateLog: EventHandler<Events.GuildMemberUpdate> = {
  name: Events.GuildMemberUpdate, module: MODULE,
  async execute(_c, oldM, newM) {
    const guild = newM.guild;
    const u = newM.user;
    const now = Date.now();

    // Nickname
    if (oldM.nickname !== newM.nickname) {
      const actor = await fetchActor(guild, AuditLogEvent.MemberUpdate, { targetId: u.id, requireChangeKey: 'nick', windowMs: 6000, now });
      const e = new EmbedBuilder().setColor(LOG_COLORS.update)
        .setAuthor({ name: `${u.tag} — nickname changed`, iconURL: u.displayAvatarURL() })
        .addFields(
          { name: 'Before', value: oldM.nickname ?? '*none*', inline: true },
          { name: 'After', value: newM.nickname ?? '*none*', inline: true },
        )
        .setTimestamp();
      if (actor && actor.id !== u.id) e.setDescription(`Changed ${actorSuffix(actor)}`);
      withIds(e, guild.id, [['User', u.id], ['Mod', actor?.id]]);
      await sendLog(guild, 'role', e);
    }

    // Roles
    const added = newM.roles.cache.filter((r) => !oldM.roles.cache.has(r.id));
    const removed = oldM.roles.cache.filter((r) => !newM.roles.cache.has(r.id));
    if (added.size || removed.size) {
      const actor = await fetchActor(guild, AuditLogEvent.MemberRoleUpdate, { targetId: u.id, windowMs: 6000, now });
      const e = new EmbedBuilder().setColor(LOG_COLORS.update)
        .setAuthor({ name: `${u.tag} — roles updated`, iconURL: u.displayAvatarURL() });
      if (actor) e.setDescription(`Updated ${actorSuffix(actor)}`);
      if (added.size) e.addFields({ name: '➕ Added', value: trim(added.map((r) => `<@&${r.id}>`).join(' ')) });
      if (removed.size) e.addFields({ name: '➖ Removed', value: trim(removed.map((r) => `<@&${r.id}>`).join(' ')) });
      e.setTimestamp();
      withIds(e, guild.id, [['User', u.id], ['Mod', actor?.id]]);
      await sendLog(guild, 'role', e);
    }

    // Timeout (communication disabled)
    const oldTo = oldM.communicationDisabledUntilTimestamp ?? 0;
    const newTo = newM.communicationDisabledUntilTimestamp ?? 0;
    if (oldTo <= now && newTo > now) {
      const actor = await fetchActor(guild, AuditLogEvent.MemberUpdate, { targetId: u.id, requireChangeKey: 'communication_disabled_until', windowMs: 6000, now });
      const e = new EmbedBuilder().setColor(LOG_COLORS.mod)
        .setAuthor({ name: `${u.tag} was timed out`, iconURL: u.displayAvatarURL() })
        .setDescription(modLine(u.tag, 'timed out', actor))
        .addFields({ name: 'Until', value: tBoth(Math.floor(newTo / 1000)), inline: true })
        .setTimestamp();
      withIds(e, guild.id, [['User', u.id], ['Mod', actor?.id]]);
      await sendLog(guild, 'moderation', e);
    } else if (oldTo > now && newTo <= now) {
      const actor = await fetchActor(guild, AuditLogEvent.MemberUpdate, { targetId: u.id, requireChangeKey: 'communication_disabled_until', windowMs: 6000, now });
      const e = new EmbedBuilder().setColor(LOG_COLORS.create)
        .setAuthor({ name: `${u.tag}'s timeout was removed`, iconURL: u.displayAvatarURL() })
        .setDescription(`Timeout removed ${actorSuffix(actor)}`)
        .setTimestamp();
      withIds(e, guild.id, [['User', u.id], ['Mod', actor?.id]]);
      await sendLog(guild, 'moderation', e);
    }
  },
};

export const banLog: EventHandler<Events.GuildBanAdd> = {
  name: Events.GuildBanAdd, module: MODULE,
  async execute(_c, ban: GuildBan) {
    const u = ban.user;
    const actor = await fetchActor(ban.guild, AuditLogEvent.MemberBanAdd, { targetId: u.id, windowMs: 8000 });
    const e = new EmbedBuilder().setColor(LOG_COLORS.delete)
      .setAuthor({ name: `${u.tag} was banned`, iconURL: u.displayAvatarURL() })
      .setDescription(modLine(u.tag, 'banned', actor, ban.reason))
      .addFields({ name: 'User', value: `<@${u.id}> (${u.id})` })
      .setTimestamp();
    withIds(e, ban.guild.id, [['User', u.id], ['Mod', actor?.id]]);
    await sendLog(ban.guild, 'moderation', e);
  },
};

export const unbanLog: EventHandler<Events.GuildBanRemove> = {
  name: Events.GuildBanRemove, module: MODULE,
  async execute(_c, ban: GuildBan) {
    const u = ban.user;
    const actor = await fetchActor(ban.guild, AuditLogEvent.MemberBanRemove, { targetId: u.id, windowMs: 8000 });
    const e = new EmbedBuilder().setColor(LOG_COLORS.create)
      .setAuthor({ name: `${u.tag} was unbanned`, iconURL: u.displayAvatarURL() })
      .setDescription(modLine(u.tag, 'unbanned', actor))
      .addFields({ name: 'User', value: `<@${u.id}> (${u.id})` })
      .setTimestamp();
    withIds(e, ban.guild.id, [['User', u.id], ['Mod', actor?.id]]);
    await sendLog(ban.guild, 'moderation', e);
  },
};
