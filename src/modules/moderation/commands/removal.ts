import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../../types/index.js';
import { canModerate } from '../../../utils/permissions.js';
import { recordModCase, dmTarget } from '../shared.js';
import { embeds } from '../../../utils/embeds.js';

export const kickCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.KickMembers],
  botPermissions: [PermissionFlagsBits.KickMembers],
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
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
    const check = canModerate(interaction.member, target);
    if (!check.ok) {
      await interaction.reply({ embeds: [embeds.error('Cannot kick', check.reason)], flags: MessageFlags.Ephemeral });
      return;
    }
    if (!target.kickable) {
      await interaction.reply({ embeds: [embeds.error('I cannot kick this member.', 'My role may be too low.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await dmTarget(target.user, interaction.guild.name, 'kicked', reason);
    await target.kick(reason ?? `By ${interaction.user.tag}`);
    const modCase = await recordModCase({
      guild: interaction.guild,
      type: 'kick',
      target: target.user,
      moderator: interaction.user,
      reason,
    });
    await interaction.reply({ embeds: [embeds.success(`Kicked ${target.user.tag}`, `**Case #${modCase.caseNumber}**${reason ? ` · ${reason}` : ''}`)] });
  },
};

export const banCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason'))
    .addIntegerOption((o) =>
      o
        .setName('delete-days')
        .setDescription('Delete this many days of their messages (0-7)')
        .setMinValue(0)
        .setMaxValue(7),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') ?? undefined;
    const deleteDays = interaction.options.getInteger('delete-days') ?? 0;

    // If the target is a member, enforce hierarchy; if not (ban by ID), skip.
    const member = interaction.options.getMember('user');
    if (member) {
      const check = canModerate(interaction.member, member);
      if (!check.ok) {
        await interaction.reply({ embeds: [embeds.error('Cannot ban', check.reason)], flags: MessageFlags.Ephemeral });
        return;
      }
      if (!member.bannable) {
        await interaction.reply({ embeds: [embeds.error('I cannot ban this member.', 'My role may be too low.')], flags: MessageFlags.Ephemeral });
        return;
      }
      await dmTarget(user, interaction.guild.name, 'banned', reason);
    }

    await interaction.guild.bans.create(user.id, {
      reason: reason ?? `By ${interaction.user.tag}`,
      deleteMessageSeconds: deleteDays * 86400,
    });
    const modCase = await recordModCase({
      guild: interaction.guild,
      type: 'ban',
      target: user,
      moderator: interaction.user,
      reason,
    });
    await interaction.reply({ embeds: [embeds.success(`Banned ${user.tag}`, `**Case #${modCase.caseNumber}**${reason ? ` · ${reason}` : ''}`)] });
  },
};

export const unbanCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.BanMembers],
  botPermissions: [PermissionFlagsBits.BanMembers],
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user by their ID')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('user-id').setDescription('The banned user’s ID').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const userId = interaction.options.getString('user-id', true).trim();
    const reason = interaction.options.getString('reason') ?? undefined;

    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      await interaction.reply({ embeds: [embeds.error('That user is not banned.')], flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.guild.bans.remove(userId, reason ?? `By ${interaction.user.tag}`);
    const modCase = await recordModCase({
      guild: interaction.guild,
      type: 'unban',
      target: ban.user,
      moderator: interaction.user,
      reason,
    });
    await interaction.reply({ embeds: [embeds.success(`Unbanned ${ban.user.tag}`, `**Case #${modCase.caseNumber}**`)] });
  },
};
