import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  AttachmentBuilder,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command } from '../../types/index.js';
import { getGuildConfig, updateGuildConfig } from '../../config/guildConfig.js';
import { generateWelcomeCard } from './card.js';
import { embeds } from '../../utils/embeds.js';

/**
 * /welcome — configure and test the welcome system. Every action requires
 * ManageGuild (we check the explicit permission, not Administrator).
 */
export const welcomeCommand: Command = {
  module: 'welcome',
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure and test the LGCY welcome system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Preview the welcome card for yourself (only you can see it)'),
    )
    .addSubcommand((s) =>
      s
        .setName('channel')
        .setDescription('Set the channel where welcome cards are posted')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The welcome channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('rules-channel')
        .setDescription('Set the #rules channel referenced in the welcome message')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The rules channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('roles-channel')
        .setDescription('Set the #roles channel referenced in the welcome message')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('The roles channel')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('status').setDescription('Show the current welcome configuration'),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'test') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const cfg = getGuildConfig(guildId);
      const primaryHex = cfg.colors.primary
        ? `#${cfg.colors.primary.toString(16).padStart(6, '0')}`
        : undefined;
      const png = await generateWelcomeCard({
        username: interaction.member.displayName,
        avatarSource: interaction.user.displayAvatarURL({ extension: 'png', size: 256 }),
        memberNumber: interaction.guild.memberCount,
        title: cfg.welcome.title,
        primaryHex,
        backgroundSource: cfg.welcomeBackground,
      });
      // Deliverability check — this is what a REAL join needs (posting to the
      // welcome channel), which /welcome test's ephemeral reply does not exercise.
      let deliver: string;
      const wc = cfg.welcomeChannelId ? interaction.guild.channels.cache.get(cfg.welcomeChannelId) : null;
      const me = interaction.guild.members.me;
      if (!cfg.welcomeChannelId) {
        deliver = '⚠️ No welcome channel configured.';
      } else if (!wc) {
        deliver = `❌ I can't see <#${cfg.welcomeChannelId}> — grant me **View Channel** there (or it was deleted).`;
      } else if (wc.type !== ChannelType.GuildText) {
        deliver = `❌ <#${cfg.welcomeChannelId}> is not a standard text channel — welcomes only post to text channels.`;
      } else {
        const perms = me ? wc.permissionsFor(me) : null;
        const need: [string, bigint][] = [
          ['View Channel', PermissionFlagsBits.ViewChannel],
          ['Send Messages', PermissionFlagsBits.SendMessages],
          ['Embed Links', PermissionFlagsBits.EmbedLinks],
          ['Attach Files', PermissionFlagsBits.AttachFiles],
        ];
        const missing = need.filter(([, f]) => !perms?.has(f)).map(([n]) => n);
        deliver = missing.length
          ? `❌ In <#${cfg.welcomeChannelId}> I'm missing: **${missing.join(', ')}** — real welcomes fail until you grant me these in that channel.`
          : `✅ Deliverable: I can post welcomes in <#${cfg.welcomeChannelId}>.`;
      }
      await interaction.editReply({
        content: `Here is how the welcome card currently looks:\n${deliver}`,
        files: [new AttachmentBuilder(png, { name: 'welcome-test.png' })],
      });
      return;
    }

    if (sub === 'channel' || sub === 'rules-channel' || sub === 'roles-channel') {
      const channel = interaction.options.getChannel('channel', true);
      updateGuildConfig(guildId, (draft) => {
        if (sub === 'channel') draft.welcomeChannelId = channel.id;
        if (sub === 'rules-channel') draft.rulesChannelId = channel.id;
        if (sub === 'roles-channel') draft.rolesChannelId = channel.id;
      });
      await interaction.reply({
        embeds: [embeds.success('Saved', `Set to <#${channel.id}>.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'status') {
      const cfg = getGuildConfig(guildId);
      await interaction.reply({
        embeds: [
          embeds
            .info('Welcome configuration')
            .addFields(
              { name: 'Welcome channel', value: cfg.welcomeChannelId ? `<#${cfg.welcomeChannelId}>` : '*not set*', inline: true },
              { name: 'Rules channel', value: cfg.rulesChannelId ? `<#${cfg.rulesChannelId}>` : '*not set*', inline: true },
              { name: 'Roles channel', value: cfg.rolesChannelId ? `<#${cfg.rolesChannelId}>` : '*not set*', inline: true },
              { name: 'Join DM', value: cfg.welcome.dmEnabled ? 'Enabled' : 'Disabled', inline: true },
              { name: 'Member count', value: cfg.welcome.showMemberCount ? 'Shown' : 'Hidden', inline: true },
            ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  },
};
