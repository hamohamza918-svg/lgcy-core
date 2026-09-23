/**
 * Static, code-level constants. Brand identity for LGCY Core.
 *
 * The Phase-1 brand is the FUN, energetic, electric-blue community look —
 * brighter than the old dark corporate LGCY branding. Per-guild overrides for
 * colors/messages live in the DB config; these are the defaults.
 */

export const BRAND = {
  name: 'LGCY',
  tagline: 'More than a server — a community.',

  /** Electric blue — the primary brand color. */
  colorPrimary: 0x2b8cff,
  /** Brighter cyan-blue accent for glows/highlights. */
  colorAccent: 0x4fd2ff,
  /** Deep navy used as the card base (not pure black — energetic, not corporate). */
  colorBackdropTop: '#0a1a3f',
  colorBackdropBottom: '#123a8a',

  /** Semantic embed colors. */
  colorSuccess: 0x35d07f,
  colorWarn: 0xffb020,
  colorDanger: 0xff4d5e,
  colorInfo: 0x2b8cff,
  colorNeutral: 0x5865f2,
} as const;

/** Emoji used across embeds/messages (unicode — no custom-emoji dependency). */
export const EMOJI = {
  wave: '👋',
  rules: '📜',
  roles: '🎭',
  chat: '💬',
  check: '✅',
  cross: '❌',
  warn: '⚠️',
  shield: '🛡️',
  ticket: '🎫',
  voice: '🔊',
} as const;

/** Discord's hard limits we defend against. */
export const LIMITS = {
  maxPurge: 100,
  maxSlowmodeSeconds: 21600, // 6h
  maxTimeoutMs: 28 * 24 * 60 * 60 * 1000, // 28 days
  embedDescriptionMax: 4096,
} as const;
