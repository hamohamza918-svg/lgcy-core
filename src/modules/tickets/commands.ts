import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  type ChatInputCommandInteraction,
  type TextChannel,
} from 'discord.js';
import type { Command } from '../../types/index.js';
import { getGuildConfig, updateGuildConfig } from '../../config/guildConfig.js';
import { ticketsRepo } from '../../database/repositories/ticketsRepo.js';
import { embeds } from '../../utils/embeds.js';
import { buildPanelEmbed, buildPanelSelect } from './ui.js';

export const ticketsCommand: Command = {
  module: 'tickets',
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  botPermissions: [PermissionFlagsBits.ManageChannels],
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Configure and manage the LGCY ticket system')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('panel')
        .setDescription('Post the ticket panel')
        .addChannelOption((o) => o.setName('channel').setDescription('Where to post (defaults to here)').addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show ticket configuration & open ticket count'))
    .addSubcommandGroup((g) =>
      g
        .setName('set')
        .setDescription('Set ticket channels & options')
        .addSubcommand((s) =>
          s.setName('parent').setDescription('Category new tickets are created under').addChannelOption((o) => o.setName('category').setDescription('Parent category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
        )
        .addSubcommand((s) =>
          s.setName('archive').setDescription('Category closed tickets move to').addChannelOption((o) => o.setName('category').setDescription('Archive category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)),
        )
        .addSubcommand((s) =>
          s.setName('log').setDescription('Ticket log channel').addChannelOption((o) => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
        )
        .addSubcommand((s) =>
          s.setName('panel-channel').setDescription('Default channel for the panel').addChannelOption((o) => o.setName('channel').setDescription('Panel channel').addChannelTypes(ChannelType.GuildText).setRequired(true)),
        )
        .addSubcommand((s) =>
          s.setName('delete-delay').setDescription('Seconds before a closed ticket auto-deletes (0 = never)').addIntegerOption((o) => o.setName('seconds').setDescription('0 to disable').setMinValue(0).setMaxValue(604800).setRequired(true)),
        )
        .addSubcommand((s) =>
          s.setName('cooldown').setDescription('Min seconds between ticket creations per user').addIntegerOption((o) => o.setName('seconds').setDescription('Cooldown seconds').setMinValue(0).setMaxValue(3600).setRequired(true)),
        ),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('staff')
        .setDescription('Manage ticket staff roles')
        .addSubcommand((s) => s.setName('add').setDescription('Add a staff role').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)))
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a staff role').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('category')
        .setDescription('Manage ticket categories')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a category')
            .addStringOption((o) => o.setName('key').setDescription('Unique key').setRequired(true))
            .addStringOption((o) => o.setName('label').setDescription('Display label').setRequired(true))
            .addStringOption((o) => o.setName('prefix').setDescription('Channel-name prefix (e.g. report)').setRequired(true))
            .addStringOption((o) => o.setName('emoji').setDescription('Emoji'))
            .addStringOption((o) => o.setName('description').setDescription('Short description'))
            .addBooleanOption((o) => o.setName('allow-multiple').setDescription('Allow multiple open tickets of this type')),
        )
        .addSubcommand((s) => s.setName('remove').setDescription('Remove a category').addStringOption((o) => o.setName('key').setDescription('Category key').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('List categories')),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const reply = (embed: import('discord.js').EmbedBuilder) =>
      interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

    // ── panel ────────────────────────────────────────────────
    if (!group && sub === 'panel') {
      const cfg = getGuildConfig(guildId);
      if (!cfg.ticketParentCategoryId) {
        await reply(embeds.error('Not configured', 'Set a parent category first: `/tickets set parent`.'));
        return;
      }
      const target = (interaction.options.getChannel('channel') as TextChannel | null) ?? (interaction.channel as TextChannel);
      await target.send({ embeds: [buildPanelEmbed()], components: [buildPanelSelect(cfg)] });
      await reply(embeds.success('Panel posted', `Posted in <#${target.id}>.`));
      return;
    }

    // ── status ───────────────────────────────────────────────
    if (!group && sub === 'status') {
      const cfg = getGuildConfig(guildId);
      const open = ticketsRepo.listOpen(guildId).length;
      await reply(
        embeds
          .info('Ticket configuration')
          .addFields(
            { name: 'Parent category', value: cfg.ticketParentCategoryId ? `<#${cfg.ticketParentCategoryId}>` : '*not set*', inline: true },
            { name: 'Archive category', value: cfg.ticketArchiveCategoryId ? `<#${cfg.ticketArchiveCategoryId}>` : '*not set*', inline: true },
            { name: 'Log channel', value: cfg.ticketLogChannelId ? `<#${cfg.ticketLogChannelId}>` : '*not set*', inline: true },
            { name: 'Staff roles', value: cfg.ticketStaffRoleIds.length ? cfg.ticketStaffRoleIds.map((r) => `<@&${r}>`).join(' ') : '*none*' },
            { name: 'Categories', value: cfg.ticketCategories.map((c) => `${c.emoji ?? ''} ${c.label}`).join('\n') || '*none*' },
            { name: 'Delete delay', value: `${cfg.ticketDeleteDelay}s`, inline: true },
            { name: 'Create cooldown', value: `${cfg.ticketCreateCooldownSec}s`, inline: true },
            { name: 'Open tickets', value: String(open), inline: true },
          ),
      );
      return;
    }

    // ── set ──────────────────────────────────────────────────
    if (group === 'set') {
      if (sub === 'parent' || sub === 'archive') {
        const cat = interaction.options.getChannel('category', true);
        updateGuildConfig(guildId, (d) => {
          if (sub === 'parent') d.ticketParentCategoryId = cat.id;
          else d.ticketArchiveCategoryId = cat.id;
        });
        await reply(embeds.success('Saved', `${sub} category → <#${cat.id}>`));
        return;
      }
      if (sub === 'log' || sub === 'panel-channel') {
        const ch = interaction.options.getChannel('channel', true);
        updateGuildConfig(guildId, (d) => {
          if (sub === 'log') d.ticketLogChannelId = ch.id;
          else d.ticketPanelChannelId = ch.id;
        });
        await reply(embeds.success('Saved', `${sub} → <#${ch.id}>`));
        return;
      }
      if (sub === 'delete-delay' || sub === 'cooldown') {
        const seconds = interaction.options.getInteger('seconds', true);
        updateGuildConfig(guildId, (d) => {
          if (sub === 'delete-delay') d.ticketDeleteDelay = seconds;
          else d.ticketCreateCooldownSec = seconds;
        });
        await reply(embeds.success('Saved', `${sub} = ${seconds}s`));
        return;
      }
    }

    // ── staff ────────────────────────────────────────────────
    if (group === 'staff') {
      const role = interaction.options.getRole('role', true);
      updateGuildConfig(guildId, (d) => {
        if (sub === 'add') {
          if (!d.ticketStaffRoleIds.includes(role.id)) d.ticketStaffRoleIds.push(role.id);
        } else {
          d.ticketStaffRoleIds = d.ticketStaffRoleIds.filter((r) => r !== role.id);
        }
      });
      await reply(embeds.success('Staff roles updated', `${sub === 'add' ? 'Added' : 'Removed'} <@&${role.id}>.`));
      return;
    }

    // ── category ─────────────────────────────────────────────
    if (group === 'category') {
      if (sub === 'list') {
        const cfg = getGuildConfig(guildId);
        const desc = cfg.ticketCategories.map((c) => `${c.emoji ?? '•'} **${c.label}** (\`${c.key}\`) → \`${c.channelPrefix}-\`${c.allowMultiple ? ' · multiple' : ''}`).join('\n');
        await reply(embeds.info('Ticket categories', desc || '*none*'));
        return;
      }
      if (sub === 'add') {
        const key = interaction.options.getString('key', true).toLowerCase().trim();
        const cfg = getGuildConfig(guildId);
        if (cfg.ticketCategories.some((c) => c.key === key)) {
          await reply(embeds.error('That category key already exists.'));
          return;
        }
        updateGuildConfig(guildId, (d) => {
          d.ticketCategories.push({
            key,
            label: interaction.options.getString('label', true),
            channelPrefix: interaction.options.getString('prefix', true).toLowerCase().replace(/[^a-z0-9]/g, '') || 'ticket',
            emoji: interaction.options.getString('emoji') ?? undefined,
            description: interaction.options.getString('description') ?? undefined,
            allowMultiple: interaction.options.getBoolean('allow-multiple') ?? false,
          });
        });
        await reply(embeds.success('Category added', `\`${key}\``));
        return;
      }
      if (sub === 'remove') {
        const key = interaction.options.getString('key', true);
        updateGuildConfig(guildId, (d) => {
          d.ticketCategories = d.ticketCategories.filter((c) => c.key !== key);
        });
        await reply(embeds.success('Category removed', `\`${key}\``));
        return;
      }
    }
  },
};
