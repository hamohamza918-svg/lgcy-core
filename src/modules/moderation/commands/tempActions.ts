import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../../types/index.js';
import { canModerate } from '../../../utils/permissions.js';
import { parseDuration, formatDuration } from '../../../utils/time.js';
import { recordModCase, dmTarget } from '../shared.js';
import { embeds } from '../../../utils/embeds.js';
import { LIMITS } from '../../../config/constants.js';

export const timeoutCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Temporarily mute a member (Discord timeout)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 2h, 1d (max 28d)').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') ?? undefined;
    const durationStr = interaction.options.getString('duration', true);
    const ms = parseDuration(durationStr);

    if (!target) {
      await interaction.reply({ embeds: [embeds.error('That user is not in this server.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!ms || ms > LIMITS.maxTimeoutMs) {
      await interaction.reply({ embeds: [embeds.error('Invalid duration', 'Use formats like `10m`, `2h`, `1d` (max 28 days).')], flags: MessageFlags.Ephemeral });
      return;
    }
    const check = canModerate(interaction.member, target);
    if (!check.ok) {
      await interaction.reply({ embeds: [embeds.error('Cannot timeout', check.reason)], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!target.moderatable) {
      await interaction.reply({ embeds: [embeds.error('I cannot timeout this member.', 'My role may be too low.')], flags: MessageFlags.Ephemeral });
      return;
    }

    await dmTarget(target.user, interaction.guild.name, 'timed out', reason, ms);
    await target.timeout(ms, reason ?? `By ${interaction.user.tag}`);
    const modCase = await recordModCase({
      guild: interaction.guild,
      type: 'timeout',
      target: target.user,
      moderator: interaction.user,
      reason,
      durationMs: ms,
    });
    await interaction.reply({
      embeds: [embeds.success(`Timed out ${target.user.tag}`, `**Case #${modCase.caseNumber}** · ${formatDuration(ms)}${reason ? ` · ${reason}` : ''}`)],
    });
  },
};

export const untimeoutCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  botPermissions: [PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a member’s timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason') ?? undefined;
    if (!target) {
      await interaction.reply({ embeds: [embeds.error('That user is not in this server.')], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!target.isCommunicationDisabled()) {
      await interaction.reply({ embeds: [embeds.warn('That member is not timed out.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await target.timeout(null, reason ?? `By ${interaction.user.tag}`);
    const modCase = await recordModCase({
      guild: interaction.guild,
      type: 'untimeout',
      target: target.user,
      moderator: interaction.user,
      reason,
    });
    await interaction.reply({
      embeds: [embeds.success(`Removed timeout for ${target.user.tag}`, `**Case #${modCase.caseNumber}**`)],
    });
  },
};
