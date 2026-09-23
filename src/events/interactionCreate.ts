import {
  Events,
  MessageFlags,
  type Interaction,
  GuildMember,
} from 'discord.js';
import type { EventHandler } from '../types/index.js';
import type { LgcyClient } from '../services/client.js';
import { parseCustomId } from '../types/index.js';
import { isFeatureEnabled } from '../config/guildConfig.js';
import {
  memberHasPermissions,
  botHasPermissions,
} from '../utils/permissions.js';
import { embeds } from '../utils/embeds.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('interaction');

/**
 * Core router for every interaction. Slash commands run through permission and
 * hierarchy validation here; component interactions (buttons/selects/modals)
 * are dispatched to the owning module via its customId prefix.
 */
export const interactionCreateEvent: EventHandler<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(client, interaction: Interaction) {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(client, interaction);
      } else if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        await command?.autocomplete?.(interaction, client);
      } else if (
        interaction.isButton() ||
        interaction.isStringSelectMenu() ||
        interaction.isUserSelectMenu() ||
        interaction.isModalSubmit()
      ) {
        await handleComponent(client, interaction);
      }
    } catch (err) {
      log.error({ err }, 'unhandled interaction error');
    }
  },
};

async function handleCommand(
  client: LgcyClient,
  interaction: import('discord.js').ChatInputCommandInteraction,
): Promise<void> {
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    await reply(interaction, embeds.error('Unknown command.'));
    return;
  }

  // Guild-only guard (unless the command opts into DMs).
  if (!interaction.inGuild() && !command.allowInDMs) {
    await reply(interaction, embeds.error('This command can only be used in a server.'));
    return;
  }

  // Feature toggle: don't run a command whose module is disabled in this guild.
  if (interaction.guildId && command.module) {
    const mod = client.modules.get(command.module);
    if (
      mod &&
      !isFeatureEnabled(interaction.guildId, mod.name, mod.defaultEnabled)
    ) {
      await reply(
        interaction,
        embeds.warn('Disabled', `The **${mod.name}** module is disabled on this server.`),
      );
      return;
    }
  }

  // Explicit permission checks — never rely on Discord Administrator alone.
  if (interaction.inCachedGuild()) {
    const member = interaction.member as GuildMember;
    const memberCheck = memberHasPermissions(
      member,
      command.memberPermissions ?? [],
    );
    if (!memberCheck.ok) {
      await reply(interaction, embeds.error('Permission denied', memberCheck.reason));
      return;
    }

    const botCheck = botHasPermissions(
      interaction.guild,
      command.botPermissions ?? [],
    );
    if (!botCheck.ok) {
      await reply(interaction, embeds.error('I cannot do that', botCheck.reason));
      return;
    }
  }

  await command.execute(interaction, client);
}

async function handleComponent(
  client: LgcyClient,
  interaction: import('../types/index.js').ComponentInteraction,
): Promise<void> {
  const { module } = parseCustomId(interaction.customId);
  const mod = client.modules.get(module);
  if (!mod?.handleComponent) {
    log.warn({ customId: interaction.customId }, 'no module handles this component');
    return;
  }
  if (
    interaction.guildId &&
    !isFeatureEnabled(interaction.guildId, mod.name, mod.defaultEnabled)
  ) {
    return;
  }
  const handled = await mod.handleComponent(interaction, client);
  if (!handled) {
    log.debug({ customId: interaction.customId }, 'component not handled by module');
  }
}

/** Reply helper that works whether or not the interaction was already deferred. */
async function reply(
  interaction: import('discord.js').ChatInputCommandInteraction,
  embed: import('discord.js').EmbedBuilder,
): Promise<void> {
  const payload = { embeds: [embed], flags: MessageFlags.Ephemeral as const };
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}
