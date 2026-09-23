import { PermissionsBitField, PermissionFlagsBits } from 'discord.js';

/**
 * The single source of truth for the permissions LGCY Core Phase 1 needs, with
 * the owning module for each. Used to compute the invite integer AND to validate
 * the bot's live permissions on first login. No Administrator.
 */
export const REQUIRED_PERMISSIONS: { flag: bigint; name: string; why: string }[] = [
  { flag: PermissionFlagsBits.ViewChannel, name: 'View Channels', why: 'base — every module reads/sends in channels' },
  { flag: PermissionFlagsBits.SendMessages, name: 'Send Messages', why: 'welcome, roles, tickets, logging, moderation replies' },
  { flag: PermissionFlagsBits.EmbedLinks, name: 'Embed Links', why: 'all embeds' },
  { flag: PermissionFlagsBits.AttachFiles, name: 'Attach Files', why: 'welcome card image + ticket transcripts' },
  { flag: PermissionFlagsBits.ReadMessageHistory, name: 'Read Message History', why: 'moderation /purge + ticket transcripts' },
  { flag: PermissionFlagsBits.ManageMessages, name: 'Manage Messages', why: 'moderation /purge; ticket message management' },
  { flag: PermissionFlagsBits.ManageChannels, name: 'Manage Channels', why: 'tickets create/rename/move/delete; /slowmode' },
  { flag: PermissionFlagsBits.ManageRoles, name: 'Manage Roles', why: 'self-roles; ticket overwrites; /lock /unlock' },
  { flag: PermissionFlagsBits.ModerateMembers, name: 'Moderate Members', why: 'moderation /timeout /untimeout' },
  { flag: PermissionFlagsBits.KickMembers, name: 'Kick Members', why: 'moderation /kick' },
  { flag: PermissionFlagsBits.BanMembers, name: 'Ban Members', why: 'moderation /ban /unban' },
];

/** Explicitly considered and dropped as unnecessary for Phase 1. */
export const DROPPED_PERMISSIONS = [
  'Administrator — never; we use explicit per-command checks',
  'Manage Webhooks — no module uses webhooks (transcripts are file uploads)',
  'Manage Nicknames, Mention Everyone, Manage Server, Manage Threads — unused',
];

export function requiredPermissionsBitfield(): PermissionsBitField {
  return new PermissionsBitField(REQUIRED_PERMISSIONS.map((r) => r.flag));
}
