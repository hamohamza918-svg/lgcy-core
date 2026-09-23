import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import type { LgcyClient } from '../../services/client.js';
import { parseCustomId } from '../../types/index.js';
import { getGuildConfig } from '../../config/guildConfig.js';
import { selfRoleBlockReason, botCanAssign } from './selfRoles.js';
import { embeds } from '../../utils/embeds.js';
import { scopedLogger } from '../../utils/logger.js';

const log = scopedLogger('roles');

/**
 * Handles the self-role select menu. Applies the diff between the member's
 * current roles and their selection, but ONLY across the roles that belong to
 * this group — never touching any other role — and re-validates every role is
 * still safe to assign before touching it.
 */
export async function handleRolesComponent(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  _client: LgcyClient,
): Promise<boolean> {
  const { action } = parseCustomId(interaction.customId);
  if (action !== 'select' || !interaction.isStringSelectMenu()) return false;
  if (!interaction.inCachedGuild()) return true;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const { args } = parseCustomId(interaction.customId);
  const groupKey = args[0];
  const cfg = getGuildConfig(interaction.guildId);
  const group = cfg.selfRoleGroups.find((g) => g.key === groupKey);
  if (!group) {
    await interaction.editReply({
      embeds: [embeds.error('That role group no longer exists.')],
    });
    return true;
  }

  const guild = interaction.guild;
  const member = interaction.member;
  const groupRoleIds = group.roles.map((r) => r.roleId);
  const selected = new Set(interaction.values);

  const added: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];

  for (const roleId of groupRoleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role) continue;

    // Defence in depth: re-check safety at click time, not just at panel build.
    if (selfRoleBlockReason(role, guild) || !botCanAssign(role, guild)) {
      if (selected.has(roleId)) skipped.push(role.name);
      continue;
    }

    const has = member.roles.cache.has(roleId);
    try {
      if (selected.has(roleId) && !has) {
        await member.roles.add(roleId, 'Self-role selection');
        added.push(role.name);
      } else if (!selected.has(roleId) && has) {
        await member.roles.remove(roleId, 'Self-role deselection');
        removed.push(role.name);
      }
    } catch (err) {
      log.error({ err, roleId }, 'failed to toggle self-role');
      skipped.push(role.name);
    }
  }

  const lines: string[] = [];
  if (added.length) lines.push(`✅ Added: ${added.join(', ')}`);
  if (removed.length) lines.push(`➖ Removed: ${removed.join(', ')}`);
  if (skipped.length) lines.push(`⚠️ Skipped: ${skipped.join(', ')}`);
  if (lines.length === 0) lines.push('No changes — you already had exactly those roles.');

  await interaction.editReply({
    embeds: [embeds.info(`${group.label} roles updated`, lines.join('\n'))],
  });
  return true;
}
