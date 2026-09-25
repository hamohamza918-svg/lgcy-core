import { z } from 'zod';
import { guildConfigRepo } from '../database/repositories/guildConfigRepo.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('guild-config');

/**
 * A single selectable self-role option shown in the roles panel.
 */
const selfRoleOptionSchema = z.object({
  roleId: z.string(),
  label: z.string(),
  description: z.string().optional(),
  emoji: z.string().optional(),
});

/**
 * A group of self-roles (e.g. "Games", "Notifications"). New groups can be
 * added at any time without touching code — this is how the roles system
 * expands into Games / Notifications / Interests / Events later.
 */
const selfRoleGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  /** false → members may pick many; true → single-choice group. */
  exclusive: z.boolean().default(false),
  minValues: z.number().int().min(0).default(0),
  maxValues: z.number().int().min(1).default(25),
  roles: z.array(selfRoleOptionSchema).default([]),
});

export type SelfRoleGroup = z.infer<typeof selfRoleGroupSchema>;

/**
 * Known logging destinations. Each can point at a different channel so one
 * giant channel never gets spammed. Unset → that category is not logged.
 */
const logChannelsSchema = z
  .object({
    member: z.string().optional(), // joins / leaves
    message: z.string().optional(), // delete / edit
    role: z.string().optional(), // role & nickname changes
    moderation: z.string().optional(), // warns / kicks / bans
    voice: z.string().optional(), // voice join/leave/move
    server: z.string().optional(), // channel/server changes
  })
  .default({});

export type LogChannels = z.infer<typeof logChannelsSchema>;

/**
 * Voice-logging options. Join/leave/move/moderator events go to the main voice
 * log (logChannels.voice); noisy self-state toggles (mute/deafen/camera/stream)
 * go to an optional separate debug channel and are OFF by default so the main
 * log stays scannable. Defaults match the requested LGCY defaults.
 */
const voiceLoggingSchema = z
  .object({
    joins: z.boolean().default(true),
    leaves: z.boolean().default(true),
    moves: z.boolean().default(true),
    sessionDuration: z.boolean().default(true),
    memberCounts: z.boolean().default(true),
    selfMuteDeafen: z.boolean().default(false),
    camera: z.boolean().default(false),
    screenShare: z.boolean().default(false),
    moderatorActions: z.boolean().default(true),
    includeIds: z.boolean().default(false),
    detailedDebug: z.boolean().default(false),
    /** Optional separate channel for detailed voice-state logs. Falls back to
     * the main voice log channel when unset. */
    debugChannelId: z.string().optional(),
  })
  .default({});

export type VoiceLoggingConfig = z.infer<typeof voiceLoggingSchema>;

/**
 * A ticket category shown in the panel's select menu. Fully configurable — the
 * channelPrefix drives channel naming (e.g. prefix "report" → `report-hamza`).
 */
const ticketCategorySchema = z.object({
  key: z.string(),
  label: z.string(),
  emoji: z.string().optional(),
  description: z.string().optional(),
  /** Channel-name prefix, e.g. "ticket", "report", "partner". */
  channelPrefix: z.string().default('ticket'),
  /** Allow a member to have more than one open ticket in this category. */
  allowMultiple: z.boolean().default(false),
});

export type TicketCategory = z.infer<typeof ticketCategorySchema>;

/** Default categories from the brief. Every field is overridable per guild. */
export function defaultTicketCategories(): TicketCategory[] {
  return [
    { key: 'general', label: 'General Support', emoji: '💬', description: 'Questions and general help', channelPrefix: 'ticket', allowMultiple: false },
    { key: 'report', label: 'Report a Member', emoji: '🚨', description: 'Report rule-breaking or bad behaviour', channelPrefix: 'report', allowMultiple: true },
    { key: 'suggestion', label: 'Suggestions / Feedback', emoji: '💡', description: 'Ideas to improve LGCY', channelPrefix: 'suggest', allowMultiple: true },
    { key: 'partner', label: 'Partnership', emoji: '🤝', description: 'Partnership and collaboration requests', channelPrefix: 'partner', allowMultiple: false },
    { key: 'technical', label: 'Technical Help', emoji: '🛠', description: 'Server / game / connection issues', channelPrefix: 'support', allowMultiple: false },
  ];
}

/**
 * The full per-guild configuration. Everything the brief lists as configurable
 * lives here — IDs, colors, messages, feature toggles. Nothing is hard-coded in
 * feature source.
 */
export const guildConfigSchema = z.object({
  // Channels
  welcomeChannelId: z.string().optional(),
  rulesChannelId: z.string().optional(),
  rolesChannelId: z.string().optional(),
  logChannels: logChannelsSchema,
  voiceLogging: voiceLoggingSchema,
  /** General logging options (member/message/role/mod/server categories). */
  logging: z
    .object({
      includeIds: z.boolean().default(true),
      /** Log EVERY message sent (high volume) to the message log channel. */
      logMessageSends: z.boolean().default(false),
    })
    .default({}),
  /** Media/attachment archive. postedChannel re-hosts uploads (preserved even
   * after deletion); deletedChannel records removed attachments. */
  fileLog: z
    .object({
      postedChannelId: z.string().optional(),
      deletedChannelId: z.string().optional(),
    })
    .default({}),

  // Tickets
  ticketPanelChannelId: z.string().optional(),
  ticketParentCategoryId: z.string().optional(), // category new tickets are created under
  ticketArchiveCategoryId: z.string().optional(), // where closed tickets are moved (if set)
  ticketLogChannelId: z.string().optional(),
  ticketStaffRoleIds: z.array(z.string()).default([]),
  ticketCategories: z.array(ticketCategorySchema).default(defaultTicketCategories),
  /** Seconds before a closed ticket channel is auto-deleted (0 = never). */
  ticketDeleteDelay: z.number().int().min(0).default(0),
  /** Minimum seconds between ticket creations per user (rate limit). */
  ticketCreateCooldownSec: z.number().int().min(0).default(60),

  // Roles
  selfRoleGroups: z.array(selfRoleGroupSchema).default([]),
  /** Staff/security roles. NEVER offered as self-roles; used for access checks. */
  staffRoleIds: z.array(z.string()).default([]),

  // Branding overrides (fall back to BRAND constants when unset)
  colors: z
    .object({
      primary: z.number().int().optional(),
      accent: z.number().int().optional(),
    })
    .default({}),
  welcomeBackground: z.string().optional(), // path/URL to a custom card background

  // Welcome copy — every string configurable
  welcome: z
    .object({
      title: z.string().default('WELCOME TO LGCY'),
      message: z
        .string()
        .default(
          'Welcome to LGCY, {member} 👋\n\nMore than a server — a community.\n\n📜 Read {rules}\n🎭 Choose your roles in {roles}\n💬 Then come say hi.',
        ),
      dmEnabled: z.boolean().default(false),
      dmMessage: z
        .string()
        .default('Welcome to **LGCY**! Glad to have you. Check out the rules and grab your roles to get started.'),
      leaveMessage: z.string().default('**{username}** just left LGCY. Take care! 👋'),
      showMemberCount: z.boolean().default(true),
    })
    .default({}),

  // Feature toggles per module. Absent → module's own defaultEnabled applies.
  features: z.record(z.string(), z.boolean()).default({}),
});

export type GuildConfig = z.infer<typeof guildConfigSchema>;

/** Returns a fully-defaulted, empty config. */
export function defaultGuildConfig(): GuildConfig {
  return guildConfigSchema.parse({});
}

// Short-TTL cache. The bot and the Control Center are SEPARATE processes that
// share this SQLite-backed config. A long-lived cache would make one process
// miss the other's writes, so entries expire quickly: a change made via a slash
// command shows up in the dashboard (and vice-versa) within a few seconds with
// no restart. Writes refresh the entry immediately for the writing process.
const CONFIG_TTL_MS = 3000;
const cache = new Map<string, { value: GuildConfig; at: number }>();

export function getGuildConfig(guildId: string): GuildConfig {
  const cached = cache.get(guildId);
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.value;

  const raw = guildConfigRepo.getRaw(guildId);
  let parsed: GuildConfig;
  if (!raw) {
    parsed = defaultGuildConfig();
  } else {
    try {
      parsed = guildConfigSchema.parse(JSON.parse(raw));
    } catch (err) {
      log.warn({ err, guildId }, 'stored config invalid — using defaults');
      parsed = defaultGuildConfig();
    }
  }
  cache.set(guildId, { value: parsed, at: Date.now() });
  return parsed;
}

/** Deep-ish merge helper for partial updates. */
export function updateGuildConfig(
  guildId: string,
  mutate: (draft: GuildConfig) => void,
): GuildConfig {
  const current = structuredClone(getGuildConfig(guildId));
  mutate(current);
  const validated = guildConfigSchema.parse(current);
  guildConfigRepo.setRaw(guildId, JSON.stringify(validated));
  cache.set(guildId, { value: validated, at: Date.now() });
  return validated;
}

/** Replaces the entire stored config for a guild (validated) and refreshes the
 * cache. Used by the Control Center's draft "apply" step. */
export function setGuildConfig(guildId: string, config: GuildConfig): GuildConfig {
  const validated = guildConfigSchema.parse(config);
  guildConfigRepo.setRaw(guildId, JSON.stringify(validated));
  cache.set(guildId, { value: validated, at: Date.now() });
  return validated;
}

/** Drops the cached config for a guild (next read reloads from storage). */
export function invalidateGuildConfig(guildId: string): void {
  cache.delete(guildId);
}

/**
 * Whether a module/feature is enabled for a guild. Explicit config wins;
 * otherwise falls back to the module's own default.
 */
export function isFeatureEnabled(
  guildId: string,
  feature: string,
  defaultEnabled: boolean,
): boolean {
  const cfg = getGuildConfig(guildId);
  return cfg.features[feature] ?? defaultEnabled;
}
