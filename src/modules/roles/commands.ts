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
import {
  buildGroupComponents,
  buildGroupEmbed,
  selfRoleBlockReason,
} from './selfRoles.js';
import { embeds } from '../../utils/embeds.js';

/**
 * /roles — admin command to build self-role groups from EXISTING server roles
 * and post the selection panel. The bot never creates roles; it only offers
 * existing, non-staff roles for self-assignment.
 */
export const rolesCommand: Command = {
  module: 'roles',
  memberPermissions: [PermissionFlagsBits.ManageRoles],
  botPermissions: [PermissionFlagsBits.ManageRoles],
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('Manage LGCY self-assignable role groups')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('group-create')
        .setDescription('Create a self-role group (e.g. Games, Notifications)')
        .addStringOption((o) => o.setName('key').setDescription('Short id, e.g. games').setRequired(true))
        .addStringOption((o) => o.setName('label').setDescription('Display name, e.g. Games').setRequired(true))
        .addBooleanOption((o) => o.setName('exclusive').setDescription('Single choice only?')),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add an EXISTING role to a group')
        .addStringOption((o) => o.setName('group').setDescription('Group key').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Existing role to offer').setRequired(true))
        .addStringOption((o) => o.setName('label').setDescription('Button label (defaults to role name)'))
        .addStringOption((o) => o.setName('emoji').setDescription('Optional emoji'))
        .addStringOption((o) => o.setName('description').setDescription('Optional description')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a role from a group')
        .addStringOption((o) => o.setName('group').setDescription('Group key').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('panel')
        .setDescription('Post the self-role selection panel for a group')
        .addStringOption((o) => o.setName('group').setDescription('Group key').setRequired(true))
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('Where to post (defaults to here)')
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List configured role groups')),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'group-create') {
      const key = interaction.options.getString('key', true).toLowerCase().trim();
      const label = interaction.options.getString('label', true);
      const exclusive = interaction.options.getBoolean('exclusive') ?? false;
      const cfg = getGuildConfig(guildId);
      if (cfg.selfRoleGroups.some((g) => g.key === key)) {
        await reply(interaction, embeds.error('That group key already exists.'));
        return;
      }
      updateGuildConfig(guildId, (d) => {
        d.selfRoleGroups.push({
          key,
          label,
          exclusive,
          minValues: 0,
          maxValues: 25,
          roles: [],
        });
      });
      await reply(interaction, embeds.success('Group created', `\`${key}\` — **${label}**${exclusive ? ' (single choice)' : ''}`));
      return;
    }

    if (sub === 'add') {
      const groupKey = interaction.options.getString('group', true);
      const role = interaction.options.getRole('role', true);
      const cfg = getGuildConfig(guildId);
      const group = cfg.selfRoleGroups.find((g) => g.key === groupKey);
      if (!group) {
        await reply(interaction, embeds.error('Unknown group.', 'Create it first with `/roles group-create`.'));
        return;
      }
      // HARD SAFETY: refuse to offer staff/security/managed/too-high roles.
      const guildRole = interaction.guild.roles.cache.get(role.id)!;
      const block = selfRoleBlockReason(guildRole, interaction.guild);
      if (block) {
        await reply(interaction, embeds.error('That role cannot be a self-role', `Reason: ${block}.`));
        return;
      }
      if (group.roles.some((r) => r.roleId === role.id)) {
        await reply(interaction, embeds.warn('Already in group.'));
        return;
      }
      updateGuildConfig(guildId, (d) => {
        const g = d.selfRoleGroups.find((x) => x.key === groupKey)!;
        g.roles.push({
          roleId: role.id,
          label: interaction.options.getString('label') ?? role.name,
          description: interaction.options.getString('description') ?? undefined,
          emoji: interaction.options.getString('emoji') ?? undefined,
        });
      });
      await reply(interaction, embeds.success('Role added', `<@&${role.id}> added to **${group.label}**.`));
      return;
    }

    if (sub === 'remove') {
      const groupKey = interaction.options.getString('group', true);
      const role = interaction.options.getRole('role', true);
      updateGuildConfig(guildId, (d) => {
        const g = d.selfRoleGroups.find((x) => x.key === groupKey);
        if (g) g.roles = g.roles.filter((r) => r.roleId !== role.id);
      });
      await reply(interaction, embeds.success('Role removed', `<@&${role.id}> removed from \`${groupKey}\`.`));
      return;
    }

    if (sub === 'panel') {
      const groupKey = interaction.options.getString('group', true);
      const cfg = getGuildConfig(guildId);
      const group = cfg.selfRoleGroups.find((g) => g.key === groupKey);
      if (!group) {
        await reply(interaction, embeds.error('Unknown group.'));
        return;
      }
      const components = buildGroupComponents(interaction.guild, group);
      if (components.length === 0) {
        await reply(interaction, embeds.error('No assignable roles in that group yet.', 'Add roles with `/roles add` first.'));
        return;
      }
      const target =
        (interaction.options.getChannel('channel') as TextChannel | null) ??
        (interaction.channel as TextChannel);
      await target.send({ embeds: [buildGroupEmbed(group)], components });
      await reply(interaction, embeds.success('Panel posted', `Posted **${group.label}** in <#${target.id}>.`));
      return;
    }

    if (sub === 'list') {
      const cfg = getGuildConfig(guildId);
      if (cfg.selfRoleGroups.length === 0) {
        await reply(interaction, embeds.info('No role groups configured yet.'));
        return;
      }
      const desc = cfg.selfRoleGroups
        .map(
          (g) =>
            `**${g.label}** (\`${g.key}\`)${g.exclusive ? ' · single-choice' : ''}\n${
              g.roles.length ? g.roles.map((r) => `• ${r.label} <@&${r.roleId}>`).join('\n') : '• *no roles yet*'
            }`,
        )
        .join('\n\n');
      await reply(interaction, embeds.info('Self-role groups', desc));
      return;
    }
  },
};

async function reply(
  interaction: ChatInputCommandInteraction,
  embed: import('discord.js').EmbedBuilder,
): Promise<void> {
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
