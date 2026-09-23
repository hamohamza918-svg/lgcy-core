import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../types/index.js';
import { getGuildConfig, updateGuildConfig, type LogChannels } from '../../config/guildConfig.js';
import { embeds } from '../../utils/embeds.js';

const CATEGORIES: (keyof LogChannels)[] = [
  'member',
  'message',
  'role',
  'moderation',
  'voice',
  'server',
];

/**
 * /logging — route each log category to its own channel so no single channel is
 * spammed. Requires ManageGuild.
 */
export const loggingCommand: Command = {
  module: 'logging',
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Configure LGCY logging destinations')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Set the channel for a log category')
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Which category')
            .setRequired(true)
            .addChoices(...CATEGORIES.map((c) => ({ name: c, value: c }))),
        )
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Destination channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('disable')
        .setDescription('Stop logging a category')
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('Which category')
            .setRequired(true)
            .addChoices(...CATEGORIES.map((c) => ({ name: c, value: c }))),
        ),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show logging configuration')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'set') {
      const category = interaction.options.getString('category', true) as keyof LogChannels;
      const channel = interaction.options.getChannel('channel', true);
      updateGuildConfig(guildId, (d) => {
        d.logChannels[category] = channel.id;
      });
      await interaction.reply({
        embeds: [embeds.success('Logging updated', `**${category}** → <#${channel.id}>`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'disable') {
      const category = interaction.options.getString('category', true) as keyof LogChannels;
      updateGuildConfig(guildId, (d) => {
        delete d.logChannels[category];
      });
      await interaction.reply({
        embeds: [embeds.success('Logging disabled', `**${category}** logging turned off.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'status') {
      const cfg = getGuildConfig(guildId);
      const lines = CATEGORIES.map((c) => {
        const id = cfg.logChannels[c];
        return `**${c}**: ${id ? `<#${id}>` : '*disabled*'}`;
      }).join('\n');
      await interaction.reply({
        embeds: [embeds.info('Logging configuration', lines)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  },
};
