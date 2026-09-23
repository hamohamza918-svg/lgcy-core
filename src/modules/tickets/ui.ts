import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  time,
  TimestampStyles,
} from 'discord.js';
import { BRAND } from '../../config/constants.js';
import type { GuildConfig, TicketCategory } from '../../config/guildConfig.js';
import type { Ticket } from '../../database/repositories/ticketsRepo.js';
import { buildCustomId } from '../../types/index.js';
import { sqliteToDate } from '../../utils/time.js';

export const CID = {
  create: 'tickets:create',
  modal: (key: string) => buildCustomId('tickets', 'modal', key),
  claim: (id: number) => buildCustomId('tickets', 'claim', String(id)),
  close: (id: number) => buildCustomId('tickets', 'close', String(id)),
  closeYes: (id: number) => buildCustomId('tickets', 'closeYes', String(id)),
  closeNo: (id: number) => buildCustomId('tickets', 'closeNo', String(id)),
  closeReason: (id: number) => buildCustomId('tickets', 'closeReason', String(id)),
  add: (id: number) => buildCustomId('tickets', 'add', String(id)),
  addSel: (id: number) => buildCustomId('tickets', 'addSel', String(id)),
  remove: (id: number) => buildCustomId('tickets', 'remove', String(id)),
  removeSel: (id: number) => buildCustomId('tickets', 'removeSel', String(id)),
  transfer: (id: number) => buildCustomId('tickets', 'transfer', String(id)),
  transferSel: (id: number) => buildCustomId('tickets', 'transferSel', String(id)),
  transcript: (id: number) => buildCustomId('tickets', 'transcript', String(id)),
  del: (id: number) => buildCustomId('tickets', 'del', String(id)),
  reopen: (id: number) => buildCustomId('tickets', 'reopen', String(id)),
} as const;

/** The public ticket panel embed. */
export function buildPanelEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(BRAND.colorPrimary)
    .setTitle('NEED HELP? 🎫')
    .setDescription(
      "We're here for you.\n\n" +
        'Choose what you need help with below and a member of the **LGCY** team ' +
        'will be with you as soon as possible.',
    )
    .setFooter({ text: 'LGCY • Community Support' });
}

/** The category select menu for the panel. */
export function buildPanelSelect(
  cfg: GuildConfig,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = cfg.ticketCategories.map((c) => {
    const opt = new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.key);
    if (c.description) opt.setDescription(c.description.slice(0, 100));
    if (c.emoji) opt.setEmoji(c.emoji);
    return opt;
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId(CID.create)
    .setPlaceholder('Choose a category…')
    .addOptions(options.length ? options : [
      new StringSelectMenuOptionBuilder().setLabel('General').setValue('general'),
    ]);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

/** Modal asking for subject + details after a category is chosen. */
export function buildTicketModal(category: TicketCategory): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(CID.modal(category.key))
    .setTitle(`New ticket · ${category.label}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('subject')
          .setLabel('Subject')
          .setPlaceholder('A short summary')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(100)
          .setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('details')
          .setLabel('Details')
          .setPlaceholder('Explain what you need help with…')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true),
      ),
    );
}

/** Modal to capture an (optional) close reason — submitting it is the confirmation. */
export function buildCloseReasonModal(ticketId: number): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(CID.closeReason(ticketId))
    .setTitle('Close ticket')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(500)
          .setRequired(false),
      ),
    );
}

/** The in-ticket metadata embed. */
export function buildTicketEmbed(
  ticket: Ticket,
  labels: { categoryLabel: string; claimedTag?: string | null },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(ticket.status === 'open' ? BRAND.colorPrimary : BRAND.colorNeutral)
    .setTitle(`🎫 Ticket #${ticket.ticketNumber}`)
    .addFields(
      { name: 'Creator', value: `<@${ticket.openerId}>`, inline: true },
      { name: 'Category', value: labels.categoryLabel, inline: true },
      { name: 'Status', value: ticket.status === 'open' ? '🟢 Open' : '🔒 Closed', inline: true },
      { name: 'Subject', value: ticket.subject ?? '—' },
      { name: 'Description', value: (ticket.description ?? '—').slice(0, 1024) },
      {
        name: 'Assigned staff',
        value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '*Unclaimed*',
        inline: true,
      },
      {
        name: 'Created',
        value: time(sqliteToDate(ticket.createdAt), TimestampStyles.ShortDateTime),
        inline: true,
      },
    );
  return embed;
}

/** Control buttons shown inside the ticket. */
export function buildControlRows(
  ticketId: number,
  closed: boolean,
): ActionRowBuilder<ButtonBuilder>[] {
  if (closed) {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(CID.transcript(ticketId)).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(CID.reopen(ticketId)).setLabel('Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(CID.del(ticketId)).setLabel('Delete').setEmoji('🗑').setStyle(ButtonStyle.Danger),
      ),
    ];
  }
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(CID.claim(ticketId)).setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(CID.close(ticketId)).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(CID.transcript(ticketId)).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(CID.add(ticketId)).setLabel('Add Member').setEmoji('➕').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CID.remove(ticketId)).setLabel('Remove Member').setEmoji('➖').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(CID.transfer(ticketId)).setLabel('Transfer').setEmoji('🔁').setStyle(ButtonStyle.Primary),
    ),
  ];
}

/** Confirm/Cancel row for closing. */
export function buildCloseConfirmRow(ticketId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CID.closeYes(ticketId)).setLabel('Confirm Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CID.closeNo(ticketId)).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );
}

/** A user-select row for add/remove/transfer flows. */
export function buildUserSelectRow(
  customId: string,
  placeholder: string,
): ActionRowBuilder<UserSelectMenuBuilder> {
  return new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
    new UserSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1),
  );
}
