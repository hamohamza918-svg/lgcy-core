import {
  Events,
  ChannelType,
  AttachmentBuilder,
  EmbedBuilder,
  time,
  TimestampStyles,
  type GuildMember,
  type PartialGuildMember,
} from 'discord.js';
import type { EventHandler } from '../../types/index.js';
import { getGuildConfig } from '../../config/guildConfig.js';
import { BRAND } from '../../config/constants.js';
import { generateWelcomeCard } from './card.js';
import { scopedLogger } from '../../utils/logger.js';

const log = scopedLogger('welcome');

/** Replaces {placeholders} in configurable welcome/leave copy. */
function formatTemplate(
  template: string,
  ctx: {
    memberMention: string;
    username: string;
    rulesMention: string;
    rolesMention: string;
    memberCount: number;
    server: string;
  },
): string {
  return template
    .replaceAll('{member}', ctx.memberMention)
    .replaceAll('{username}', ctx.username)
    .replaceAll('{rules}', ctx.rulesMention)
    .replaceAll('{roles}', ctx.rolesMention)
    .replaceAll('{memberCount}', String(ctx.memberCount))
    .replaceAll('{server}', ctx.server);
}

function channelMention(id: string | undefined, fallback: string): string {
  return id ? `<#${id}>` : fallback;
}

export const guildMemberAddEvent: EventHandler<Events.GuildMemberAdd> = {
  name: Events.GuildMemberAdd,
  module: 'welcome',
  async execute(_client, member: GuildMember) {
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg.welcomeChannelId) return;

    const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) {
      log.warn({ guildId: member.guild.id }, 'welcome channel missing/not text');
      return;
    }

    const isBot = member.user.bot;
    const primaryHex = cfg.colors.primary
      ? `#${cfg.colors.primary.toString(16).padStart(6, '0')}`
      : undefined;

    // Bot accounts get a lightweight notice, not a full welcome card.
    if (isBot) {
      await channel
        .send({ content: `🤖 Bot **${member.user.username}** was added to the server.` })
        .catch((err) => log.error({ err }, 'failed to post bot notice'));
      return;
    }

    const memberNumber = cfg.welcome.showMemberCount
      ? member.guild.memberCount
      : undefined;

    try {
      const png = await generateWelcomeCard({
        username: member.displayName,
        avatarSource: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
        memberNumber,
        title: cfg.welcome.title,
        primaryHex,
        backgroundSource: cfg.welcomeBackground,
      });
      const attachment = new AttachmentBuilder(png, { name: 'welcome.png' });

      const messageText = formatTemplate(cfg.welcome.message, {
        memberMention: `<@${member.id}>`,
        username: member.displayName,
        rulesMention: channelMention(cfg.rulesChannelId, '#rules'),
        rolesMention: channelMention(cfg.rolesChannelId, '#roles'),
        memberCount: member.guild.memberCount,
        server: member.guild.name,
      });

      const embed = new EmbedBuilder()
        .setColor(cfg.colors.primary ?? BRAND.colorPrimary)
        .setDescription(messageText)
        .setFooter({
          text: cfg.welcome.showMemberCount
            ? `You are member #${member.guild.memberCount}`
            : BRAND.name,
        })
        .addFields({
          name: 'Account created',
          value: time(member.user.createdAt, TimestampStyles.RelativeTime),
          inline: true,
        });

      await channel.send({
        content: `<@${member.id}>`,
        files: [attachment],
        embeds: [embed],
      });

      if (cfg.welcome.dmEnabled) {
        await member
          .send({ content: cfg.welcome.dmMessage })
          .catch(() => log.debug({ userId: member.id }, 'welcome DM blocked'));
      }
    } catch (err) {
      log.error({ err, guildId: member.guild.id }, 'failed to send welcome');
    }
  },
};

export const guildMemberRemoveEvent: EventHandler<Events.GuildMemberRemove> = {
  name: Events.GuildMemberRemove,
  module: 'welcome',
  async execute(_client, member: GuildMember | PartialGuildMember) {
    const cfg = getGuildConfig(member.guild.id);
    if (!cfg.welcomeChannelId) return;
    const channel = member.guild.channels.cache.get(cfg.welcomeChannelId);
    if (!channel || channel.type !== ChannelType.GuildText) return;

    const text = formatTemplate(cfg.welcome.leaveMessage, {
      memberMention: `<@${member.id}>`,
      username: member.user?.username ?? 'A member',
      rulesMention: channelMention(cfg.rulesChannelId, '#rules'),
      rolesMention: channelMention(cfg.rolesChannelId, '#roles'),
      memberCount: member.guild.memberCount,
      server: member.guild.name,
    });

    await channel
      .send({
        embeds: [new EmbedBuilder().setColor(BRAND.colorNeutral).setDescription(text)],
      })
      .catch((err) => log.error({ err }, 'failed to send leave message'));
  },
};
