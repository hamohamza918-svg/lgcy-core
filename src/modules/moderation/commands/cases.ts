import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../../types/index.js';
import { canModerate } from '../../../utils/permissions.js';
import { modCasesRepo } from '../../../database/repositories/modCasesRepo.js';
import { recordModCase, dmTarget } from '../shared.js';
import { embeds } from '../../../utils/embeds.js';
import { BRAND } from '../../../config/constants.js';

export const warnCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const target = interaction.options.getMember('user');
    const reason = interaction.options.getString('reason', true);
    if (!target) {
      await interaction.reply({ embeds: [embeds.error('That user is not in this server.')], flags: MessageFlags.Ephemeral });
      return;
    }
    const check = canModerate(interaction.member, target);
    if (!check.ok) {
      await interaction.reply({ embeds: [embeds.error('Cannot warn', check.reason)], flags: MessageFlags.Ephemeral });
      return;
    }

    const modCase = await recordModCase({
      guild: interaction.guild,
      type: 'warn',
      target: target.user,
      moderator: interaction.user,
      reason,
    });
    await dmTarget(target.user, interaction.guild.name, 'warned', reason);

    const total = modCasesRepo.countWarnings(interaction.guildId, target.id);
    await interaction.reply({
      embeds: [
        embeds.success(
          `Warned ${target.user.tag}`,
          `**Case #${modCase.caseNumber}** · Reason: ${reason}\nThis member now has **${total}** active warning(s).`,
        ),
      ],
    });
  },
};

export const warningsCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ModerateMembers],
  data: new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View a member’s moderation history')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('Member to inspect').setRequired(true)),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('user', true);
    const cases = modCasesRepo.listForTarget(interaction.guildId, user.id);
    if (cases.length === 0) {
      await interaction.reply({ embeds: [embeds.info(`No cases for ${user.tag}.`)], flags: MessageFlags.Ephemeral });
      return;
    }
    const desc = cases
      .slice(0, 15)
      .map(
        (c) =>
          `**#${c.caseNumber}** \`${c.type}\` · <t:${Math.floor(new Date(c.createdAt + 'Z').getTime() / 1000)}:R>\n` +
          `by <@${c.moderatorId}> — ${c.reason ?? '*no reason*'}`,
      )
      .join('\n\n');
    const embed = new EmbedBuilder()
      .setColor(BRAND.colorInfo)
      .setAuthor({ name: `Moderation history — ${user.tag}`, iconURL: user.displayAvatarURL() })
      .setDescription(desc)
      .setFooter({ text: `${cases.length} total case(s)` });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
