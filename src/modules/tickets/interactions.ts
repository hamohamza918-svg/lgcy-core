import {
  MessageFlags,
  ChannelType,
  AttachmentBuilder,
  type TextChannel,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LgcyClient } from '../../services/client.js';
import { parseCustomId, type ComponentInteraction } from '../../types/index.js';
import { getGuildConfig, type GuildConfig } from '../../config/guildConfig.js';
import { ticketsRepo, type Ticket } from '../../database/repositories/ticketsRepo.js';
import { embeds } from '../../utils/embeds.js';
import { toSqliteTime } from '../../utils/time.js';
import {
  memberIsTicketStaff,
  authorizeTicketAction,
  validateTicketContext,
  type TicketAction,
} from './authz.js';
import {
  createTicket,
  applyClosedChannelState,
  addMemberAccess,
  removeMemberAccess,
} from './service.js';
import { generateTranscript } from './transcript.js';
import { logTicketEvent } from './log.js';
import { formatDuration, sqliteToDate } from '../../utils/time.js';
import {
  CID,
  buildTicketModal,
  buildCloseReasonModal,
  buildTicketEmbed,
  buildControlRows,
  buildCloseConfirmRow,
  buildUserSelectRow,
} from './ui.js';

const TRANSCRIPT_DIR = resolve(process.cwd(), 'transcripts');

/** Category label lookup with a safe fallback. */
function categoryLabel(cfg: GuildConfig, key: string): string {
  return cfg.ticketCategories.find((c) => c.key === key)?.label ?? key;
}

/** Checks per-user rate limit + duplicate-open-category rule. */
function checkCreateAllowed(
  cfg: GuildConfig,
  guildId: string,
  openerId: string,
  categoryKey: string,
): { ok: boolean; reason?: string } {
  const category = cfg.ticketCategories.find((c) => c.key === categoryKey);
  if (!category) return { ok: false, reason: 'That category no longer exists.' };

  if (cfg.ticketCreateCooldownSec > 0) {
    const since = toSqliteTime(new Date(Date.now() - cfg.ticketCreateCooldownSec * 1000));
    const recent = ticketsRepo.countCreatedSince(guildId, openerId, since);
    if (recent > 0) {
      return { ok: false, reason: `You're doing that too fast. Wait a moment before opening another ticket.` };
    }
  }
  if (!category.allowMultiple) {
    const dupe = ticketsRepo.findOpenByOpenerCategory(guildId, openerId, categoryKey);
    if (dupe) {
      return {
        ok: false,
        reason: `You already have an open **${category.label}** ticket${dupe.channelId ? ` (<#${dupe.channelId}>)` : ''}.`,
      };
    }
  }
  return { ok: true };
}

/** Loads a ticket referenced by a component and validates the acting context. */
async function loadForAction(
  interaction: ButtonInteraction | UserSelectMenuInteraction | ModalSubmitInteraction,
  idStr: string | undefined,
  action: TicketAction,
): Promise<{ ticket: Ticket; channel: TextChannel; isStaff: boolean; isOpener: boolean } | null> {
  if (!interaction.inCachedGuild()) return null;
  const id = Number(idStr);
  const ticket = Number.isFinite(id) ? ticketsRepo.getById(id) : null;

  const ctx = validateTicketContext(ticket, interaction.guildId, interaction.channelId);
  if (!ctx.ok || !ticket) {
    await interaction.reply({ embeds: [embeds.error('Cannot continue', ctx.reason)], flags: MessageFlags.Ephemeral });
    return null;
  }

  const cfg = getGuildConfig(interaction.guildId);
  const isStaff = memberIsTicketStaff(interaction.member, cfg);
  const isOpener = interaction.user.id === ticket.openerId;
  const authz = authorizeTicketAction(action, { isStaff, isOpener });
  if (!authz.ok) {
    await interaction.reply({ embeds: [embeds.error('Not allowed', authz.reason)], flags: MessageFlags.Ephemeral });
    return null;
  }

  const channel = interaction.guild.channels.cache.get(ticket.channelId ?? '') as TextChannel | undefined;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({ embeds: [embeds.error('Ticket channel not found.')], flags: MessageFlags.Ephemeral });
    return null;
  }
  return { ticket, channel, isStaff, isOpener };
}

/** Re-renders the ticket's control message (embed + buttons) from DB state. */
async function refreshControls(client: LgcyClient, channel: TextChannel, ticket: Ticket, cfg: GuildConfig): Promise<void> {
  const msgs = await channel.messages.fetch({ after: '0', limit: 5 }).catch(() => null);
  const control = msgs?.find(
    (m) => m.author.id === client.user?.id && m.embeds[0]?.title?.includes(`Ticket #${ticket.ticketNumber}`),
  );
  if (control) {
    await control
      .edit({
        embeds: [buildTicketEmbed(ticket, { categoryLabel: categoryLabel(cfg, ticket.category) })],
        components: buildControlRows(ticket.id, ticket.status === 'closed'),
      })
      .catch(() => undefined);
  }
}

function storeTranscript(buffer: Buffer, filename: string): string {
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  const path = resolve(TRANSCRIPT_DIR, filename);
  writeFileSync(path, buffer);
  return path;
}

/**
 * Root router for every ticket component. Returns true when handled. Every
 * branch re-validates guild + ticket + user + role + state server-side — the
 * customId is only a hint, never trusted for authorization.
 */
export async function handleTicketsComponent(
  interaction: ComponentInteraction,
  client: LgcyClient,
): Promise<boolean> {
  const { action, args } = parseCustomId(interaction.customId);
  if (!interaction.inCachedGuild()) return true;
  const cfg = getGuildConfig(interaction.guildId);
  const idStr = args[0];

  switch (action) {
    // ── Panel: category chosen → open the subject/details modal ──────────
    case 'create': {
      if (!interaction.isStringSelectMenu()) return false;
      const categoryKey = interaction.values[0]!;
      const category = cfg.ticketCategories.find((c) => c.key === categoryKey);
      if (!category) {
        await interaction.reply({ embeds: [embeds.error('Unknown category.')], flags: MessageFlags.Ephemeral });
        return true;
      }
      const allowed = checkCreateAllowed(cfg, interaction.guildId, interaction.user.id, categoryKey);
      if (!allowed.ok) {
        await interaction.reply({ embeds: [embeds.warn('Hold on', allowed.reason)], flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.showModal(buildTicketModal(category));
      return true;
    }

    // ── Modal submitted → create the ticket ──────────────────────────────
    case 'modal': {
      if (!interaction.isModalSubmit()) return false;
      const categoryKey = idStr!;
      const category = cfg.ticketCategories.find((c) => c.key === categoryKey);
      if (!category) {
        await interaction.reply({ embeds: [embeds.error('Unknown category.')], flags: MessageFlags.Ephemeral });
        return true;
      }
      // Re-validate rate limit + duplicate at submit time (never trust the client).
      const allowed = checkCreateAllowed(cfg, interaction.guildId, interaction.user.id, categoryKey);
      if (!allowed.ok) {
        await interaction.reply({ embeds: [embeds.warn('Hold on', allowed.reason)], flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const subject = interaction.fields.getTextInputValue('subject').trim();
      const details = interaction.fields.getTextInputValue('details').trim();
      try {
        const { ticket, channel } = await createTicket(
          interaction.guild,
          interaction.member,
          cfg,
          category,
          subject,
          details,
        );
        await logTicketEvent(interaction.guild, 'created', [
          { name: 'Ticket', value: `#${ticket.ticketNumber} · ${channel}`, inline: true },
          { name: 'Creator', value: `<@${ticket.openerId}>`, inline: true },
          { name: 'Category', value: category.label, inline: true },
          { name: 'Subject', value: subject },
        ]);
        await interaction.editReply({ embeds: [embeds.success('Ticket created', `Your ticket is ready: ${channel}`)] });
      } catch (err) {
        await interaction.editReply({ embeds: [embeds.error('Could not open ticket', (err as Error).message)] });
      }
      return true;
    }

    // ── Claim (atomic, collision-safe) ───────────────────────────────────
    case 'claim': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'claim');
      if (!loaded) return true;
      if (loaded.ticket.claimedBy) {
        await interaction.reply({
          embeds: [embeds.warn('Already claimed', `This ticket is handled by <@${loaded.ticket.claimedBy}>. Use **Transfer** to reassign.`)],
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      const ok = ticketsRepo.claim(loaded.ticket.id, interaction.user.id);
      if (!ok) {
        await interaction.reply({ embeds: [embeds.warn('Already claimed', 'Someone claimed it a moment ago.')], flags: MessageFlags.Ephemeral });
        return true;
      }
      const updated = ticketsRepo.getById(loaded.ticket.id)!;
      await refreshControls(client, loaded.channel, updated, cfg);
      await interaction.reply({ embeds: [embeds.success('Claimed', `You are now handling ticket #${updated.ticketNumber}.`)], flags: MessageFlags.Ephemeral });
      await logTicketEvent(interaction.guild, 'claimed', [
        { name: 'Ticket', value: `#${updated.ticketNumber}`, inline: true },
        { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true },
      ]);
      return true;
    }

    // ── Close: ask for confirmation ──────────────────────────────────────
    case 'close': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'close');
      if (!loaded) return true;
      if (loaded.ticket.status !== 'open') {
        await interaction.reply({ embeds: [embeds.warn('This ticket is already closed.')], flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.reply({
        embeds: [embeds.warn('Close this ticket?', 'This will lock messaging and generate a transcript.')],
        components: [buildCloseConfirmRow(loaded.ticket.id)],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    case 'closeNo': {
      if (!interaction.isButton()) return false;
      await interaction.update({ embeds: [embeds.info('Cancelled', 'The ticket stays open.')], components: [] });
      return true;
    }
    case 'closeYes': {
      if (!interaction.isButton()) return false;
      // Confirmed → collect an optional reason via modal (submitting = final confirm).
      await interaction.showModal(buildCloseReasonModal(Number(idStr)));
      return true;
    }

    // ── Close reason modal → perform the close ───────────────────────────
    case 'closeReason': {
      if (!interaction.isModalSubmit()) return false;
      const loaded = await loadForAction(interaction, idStr, 'close');
      if (!loaded) return true;
      const reason = interaction.fields.getTextInputValue('reason').trim() || null;
      const ok = ticketsRepo.close(loaded.ticket.id, interaction.user.id, reason);
      if (!ok) {
        await interaction.reply({ embeds: [embeds.warn('Already closed.')], flags: MessageFlags.Ephemeral });
        return true;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const updated = ticketsRepo.getById(loaded.ticket.id)!;

      // Transcript BEFORE archiving/locking so all messages are captured.
      let attachment: AttachmentBuilder | undefined;
      try {
        const t = await generateTranscript(loaded.channel, updated);
        storeTranscript(t.buffer, t.filename);
        attachment = new AttachmentBuilder(t.buffer, { name: t.filename });
      } catch {
        /* transcript best-effort */
      }

      await applyClosedChannelState(loaded.channel, updated, cfg);
      await refreshControls(client, loaded.channel, updated, cfg);
      await loaded.channel.send({
        embeds: [embeds.info('🔒 Ticket closed', `Closed by <@${interaction.user.id}>${reason ? `\n**Reason:** ${reason}` : ''}`)],
      }).catch(() => undefined);

      const catLabel = cfg.ticketCategories.find((c) => c.key === updated.category)?.label ?? updated.category;
      const durationMs = Date.now() - sqliteToDate(updated.createdAt).getTime();
      await logTicketEvent(
        interaction.guild,
        'closed',
        [
          { name: '🎫 Ticket', value: `#${updated.ticketNumber}${updated.subject ? ` — ${updated.subject}` : ''}` },
          { name: 'Category', value: catLabel, inline: true },
          { name: 'Opened by', value: `<@${updated.openerId}>`, inline: true },
          { name: 'Claimed by', value: updated.claimedBy ? `<@${updated.claimedBy}>` : '*unclaimed*', inline: true },
          { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Duration', value: formatDuration(durationMs), inline: true },
          { name: 'Reason', value: reason ?? '*none*', inline: true },
        ],
        attachment,
      );
      await interaction.editReply({ embeds: [embeds.success('Ticket closed', 'A transcript has been generated.')] });

      // Optional delayed deletion when no archive category is configured.
      if (!cfg.ticketArchiveCategoryId && cfg.ticketDeleteDelay > 0) {
        const chan = loaded.channel;
        setTimeout(() => {
          chan.delete('Ticket auto-delete after close').catch(() => undefined);
          logTicketEvent(interaction.guild, 'deleted', [{ name: 'Ticket', value: `#${updated.ticketNumber}` }]).catch(() => undefined);
        }, cfg.ticketDeleteDelay * 1000);
      }
      return true;
    }

    // ── Add / Remove / Transfer: open a user picker ──────────────────────
    case 'add': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'add');
      if (!loaded) return true;
      await interaction.reply({
        content: 'Select a member to add to this ticket:',
        components: [buildUserSelectRow(CID.addSel(loaded.ticket.id), 'Choose a member')],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    case 'remove': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'remove');
      if (!loaded) return true;
      await interaction.reply({
        content: 'Select a member to remove from this ticket:',
        components: [buildUserSelectRow(CID.removeSel(loaded.ticket.id), 'Choose a member')],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    case 'transfer': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'transfer');
      if (!loaded) return true;
      await interaction.reply({
        content: 'Select a **staff member** to transfer this ticket to:',
        components: [buildUserSelectRow(CID.transferSel(loaded.ticket.id), 'Choose a staff member')],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    case 'addSel': {
      if (!interaction.isUserSelectMenu()) return false;
      const loaded = await loadForAction(interaction, idStr, 'add');
      if (!loaded) return true;
      const userId = interaction.values[0]!;
      await addMemberAccess(loaded.channel, userId);
      await interaction.update({ embeds: [embeds.success('Member added', `<@${userId}> can now access this ticket.`)], content: '', components: [] });
      await loaded.channel.send({ embeds: [embeds.info('➕ Member added', `<@${userId}> was added by <@${interaction.user.id}>.`)] }).catch(() => undefined);
      await logTicketEvent(interaction.guild, 'member_added', [
        { name: 'Ticket', value: `#${loaded.ticket.ticketNumber}`, inline: true },
        { name: 'Member', value: `<@${userId}>`, inline: true },
        { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
      ]);
      return true;
    }
    case 'removeSel': {
      if (!interaction.isUserSelectMenu()) return false;
      const loaded = await loadForAction(interaction, idStr, 'remove');
      if (!loaded) return true;
      const userId = interaction.values[0]!;
      if (userId === loaded.ticket.openerId) {
        await interaction.update({ embeds: [embeds.error('Cannot remove the ticket creator.')], content: '', components: [] });
        return true;
      }
      await removeMemberAccess(loaded.channel, userId);
      await interaction.update({ embeds: [embeds.success('Member removed', `<@${userId}> can no longer access this ticket.`)], content: '', components: [] });
      await logTicketEvent(interaction.guild, 'member_removed', [
        { name: 'Ticket', value: `#${loaded.ticket.ticketNumber}`, inline: true },
        { name: 'Member', value: `<@${userId}>`, inline: true },
        { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
      ]);
      return true;
    }
    case 'transferSel': {
      if (!interaction.isUserSelectMenu()) return false;
      const loaded = await loadForAction(interaction, idStr, 'transfer');
      if (!loaded) return true;
      const userId = interaction.values[0]!;
      const target = await interaction.guild.members.fetch(userId).catch(() => null);
      if (!target || !memberIsTicketStaff(target, cfg)) {
        await interaction.update({ embeds: [embeds.error('Invalid transfer', 'You can only transfer a ticket to a staff member.')], content: '', components: [] });
        return true;
      }
      ticketsRepo.transfer(loaded.ticket.id, userId);
      const updated = ticketsRepo.getById(loaded.ticket.id)!;
      await refreshControls(client, loaded.channel, updated, cfg);
      await interaction.update({ embeds: [embeds.success('Transferred', `Ticket #${updated.ticketNumber} is now handled by <@${userId}>.`)], content: '', components: [] });
      await logTicketEvent(interaction.guild, 'transferred', [
        { name: 'Ticket', value: `#${updated.ticketNumber}`, inline: true },
        { name: 'To', value: `<@${userId}>`, inline: true },
        { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
      ]);
      return true;
    }

    // ── Transcript ───────────────────────────────────────────────────────
    case 'transcript': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'transcript');
      if (!loaded) return true;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const t = await generateTranscript(loaded.channel, loaded.ticket);
      storeTranscript(t.buffer, t.filename);
      const attachment = new AttachmentBuilder(t.buffer, { name: t.filename });
      await interaction.editReply({ embeds: [embeds.success('Transcript generated', `${t.messageCount} message(s) captured.`)], files: [attachment] });
      await logTicketEvent(
        interaction.guild,
        'transcript',
        [
          { name: 'Ticket', value: `#${loaded.ticket.ticketNumber}`, inline: true },
          { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
        ],
        new AttachmentBuilder(t.buffer, { name: t.filename }),
      );
      return true;
    }

    // ── Reopen ───────────────────────────────────────────────────────────
    case 'reopen': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'reopen');
      if (!loaded) return true;
      if (!ticketsRepo.reopen(loaded.ticket.id)) {
        await interaction.reply({ embeds: [embeds.warn('Ticket is already open.')], flags: MessageFlags.Ephemeral });
        return true;
      }
      const updated = ticketsRepo.getById(loaded.ticket.id)!;
      await loaded.channel.permissionOverwrites.edit(updated.openerId, { SendMessages: true }).catch(() => undefined);
      if (cfg.ticketParentCategoryId) {
        await loaded.channel.setParent(cfg.ticketParentCategoryId, { lockPermissions: false }).catch(() => undefined);
      }
      await refreshControls(client, loaded.channel, updated, cfg);
      await interaction.reply({ embeds: [embeds.success('Ticket reopened')], flags: MessageFlags.Ephemeral });
      await logTicketEvent(interaction.guild, 'reopened', [
        { name: 'Ticket', value: `#${updated.ticketNumber}`, inline: true },
        { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
      ]);
      return true;
    }

    // ── Delete channel ───────────────────────────────────────────────────
    case 'del': {
      if (!interaction.isButton()) return false;
      const loaded = await loadForAction(interaction, idStr, 'delete');
      if (!loaded) return true;
      await interaction.reply({ embeds: [embeds.warn('Deleting ticket channel in 3s…')], flags: MessageFlags.Ephemeral });
      await logTicketEvent(interaction.guild, 'deleted', [
        { name: 'Ticket', value: `#${loaded.ticket.ticketNumber}`, inline: true },
        { name: 'By', value: `<@${interaction.user.id}>`, inline: true },
      ]);
      setTimeout(() => loaded.channel.delete('Ticket deleted by staff').catch(() => undefined), 3000);
      return true;
    }

    default:
      return false;
  }
}
