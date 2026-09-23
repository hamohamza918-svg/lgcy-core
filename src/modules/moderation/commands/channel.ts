import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { Command } from '../../../types/index.js';
import { embeds } from '../../../utils/embeds.js';
import { LIMITS } from '../../../config/constants.js';
import { formatDuration } from '../../../utils/time.js';

export const purgeCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ManageMessages],
  botPermissions: [PermissionFlagsBits.ManageMessages],
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Bulk-delete recent messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('How many (1-100)').setMinValue(1).setMaxValue(LIMITS.maxPurge).setRequired(true),
    )
    .addUserOption((o) => o.setName('user').setDescription('Only delete messages from this user')),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild() || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({ embeds: [embeds.error('Run this in a text channel.')], flags: MessageFlags.Ephemeral });
      return;
    }
    const amount = interaction.options.getInteger('amount', true);
    const user = interaction.options.getUser('user');
    const channel = interaction.channel as TextChannel;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let messages = await channel.messages.fetch({ limit: amount });
    if (user) messages = messages.filter((m) => m.author.id === user.id);
    // bulkDelete silently ignores messages older than 14 days.
    const deleted = await channel.bulkDelete(messages, true).catch(() => null);
    if (!deleted) {
      await interaction.editReply({ embeds: [embeds.error('Failed to purge', 'Messages older than 14 days cannot be bulk-deleted.')] });
      return;
    }
    await interaction.editReply({
      embeds: [embeds.success('Purged', `Deleted **${deleted.size}** message(s)${user ? ` from ${user.tag}` : ''}.`)],
    });
  },
};

export const slowmodeCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Set slowmode for this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption((o) =>
      o
        .setName('seconds')
        .setDescription('Seconds between messages (0 to disable, max 21600)')
        .setMinValue(0)
        .setMaxValue(LIMITS.maxSlowmodeSeconds)
        .setRequired(true),
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild() || interaction.channel?.type !== ChannelType.GuildText) {
      await interaction.reply({ embeds: [embeds.error('Run this in a text channel.')], flags: MessageFlags.Ephemeral });
      return;
    }
    const seconds = interaction.options.getInteger('seconds', true);
    const channel = interaction.channel as TextChannel;
    await channel.setRateLimitPerUser(seconds, `By ${interaction.user.tag}`);
    await interaction.reply({
      embeds: [
        seconds === 0
          ? embeds.success('Slowmode disabled')
          : embeds.success('Slowmode set', `One message every **${formatDuration(seconds * 1000)}**.`),
      ],
    });
  },
};

async function setLock(interaction: ChatInputCommandInteraction, lock: boolean): Promise<void> {
  if (!interaction.inCachedGuild() || interaction.channel?.type !== ChannelType.GuildText) {
    await interaction.reply({ embeds: [embeds.error('Run this in a text channel.')], flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = interaction.channel as TextChannel;
  const everyone = interaction.guild.roles.everyone;
  await channel.permissionOverwrites.edit(everyone, { SendMessages: lock ? false : null }, {
    reason: `${lock ? 'Locked' : 'Unlocked'} by ${interaction.user.tag}`,
  });
  await interaction.reply({
    embeds: [
      lock
        ? embeds.success('🔒 Channel locked', 'Members can no longer send messages here.')
        : embeds.success('🔓 Channel unlocked', 'Members can send messages again.'),
    ],
  });
}

export const lockCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Lock this channel (deny @everyone from sending)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  execute: (interaction) => setLock(interaction, true),
};

export const unlockCommand: Command = {
  module: 'moderation',
  memberPermissions: [PermissionFlagsBits.ManageChannels],
  botPermissions: [PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Unlock this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  execute: (interaction) => setLock(interaction, false),
};
