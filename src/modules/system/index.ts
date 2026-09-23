import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { Command, Module } from '../../types/index.js';
import type { LgcyClient } from '../../services/client.js';
import { updateGuildConfig, isFeatureEnabled } from '../../config/guildConfig.js';
import { embeds } from '../../utils/embeds.js';
import { BRAND } from '../../config/constants.js';

const pingCommand: Command = {
  module: 'system',
  data: new SlashCommandBuilder().setName('ping').setDescription('Check that LGCY Core is responsive'),
  async execute(interaction: ChatInputCommandInteraction, client: LgcyClient) {
    await interaction.reply({
      embeds: [embeds.success('Pong!', `WebSocket latency: **${Math.round(client.ws.ping)}ms**`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

const modulesCommand: Command = {
  module: 'system',
  memberPermissions: [PermissionFlagsBits.ManageGuild],
  data: new SlashCommandBuilder()
    .setName('modules')
    .setDescription('List LGCY modules and enable/disable them')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('list').setDescription('List all modules and their status'))
    .addSubcommand((s) =>
      s
        .setName('enable')
        .setDescription('Enable a module on this server')
        .addStringOption((o) => o.setName('name').setDescription('Module name').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('disable')
        .setDescription('Disable a module on this server')
        .addStringOption((o) => o.setName('name').setDescription('Module name').setRequired(true)),
    ),
  async execute(interaction: ChatInputCommandInteraction, client: LgcyClient) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'list') {
      const lines = [...client.modules.values()].map((m) => {
        const enabled = isFeatureEnabled(guildId, m.name, m.defaultEnabled);
        return `${enabled ? '🟢' : '⚪'} **${m.name}** — ${m.description}`;
      });
      await interaction.reply({
        embeds: [embeds.info('LGCY modules', lines.join('\n')).setColor(BRAND.colorPrimary)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const name = interaction.options.getString('name', true).toLowerCase();
    const mod = client.modules.get(name);
    if (!mod) {
      await interaction.reply({ embeds: [embeds.error('Unknown module.', `Use \`/modules list\`.`)], flags: MessageFlags.Ephemeral });
      return;
    }
    const enable = sub === 'enable';
    updateGuildConfig(guildId, (d) => {
      d.features[name] = enable;
    });
    await interaction.reply({
      embeds: [embeds.success(`Module ${enable ? 'enabled' : 'disabled'}`, `**${name}** is now ${enable ? '🟢 enabled' : '⚪ disabled'} on this server.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

/**
 * System module — always-on diagnostics and the module enable/disable control
 * surface. This is how features are toggled per guild without code changes.
 */
export const systemModule: Module = {
  name: 'system',
  description: 'Diagnostics and per-guild module toggles.',
  version: '1.0.0',
  defaultEnabled: true,
  dashboard: { icon: '🛰️', section: 'bot', configurable: false },
  commands: [pingCommand, modulesCommand],
};
