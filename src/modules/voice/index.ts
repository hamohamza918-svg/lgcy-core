import type { Module } from '../../types/index.js';

/**
 * Temporary / private voice module — INTENTIONALLY DORMANT.
 *
 * The server already has four Private voice rooms that may be driven by another
 * bot/system. Per the Phase-1 plan we do NOT interfere with those yet: this
 * module ships disabled (defaultEnabled: false) and registers no events, so the
 * bot cannot touch voice state until we understand the existing setup and
 * explicitly enable it.
 *
 * Planned surface (future step): Join-to-Create hub channel → temporary channel
 * per user with owner controls (lock/unlock, hide/show, user limit, rename,
 * permit/reject, transfer ownership) and automatic cleanup when empty. State
 * lives in the `temp_voice` table (already migrated) so enabling this later is
 * additive — no core changes required.
 */
export const voiceModule: Module = {
  name: 'voice',
  description: 'Temporary/private voice channels (disabled until the existing Private system is understood).',
  version: '0.1.0',
  defaultEnabled: false,
  dashboard: { icon: '🔊', section: 'voice', configurable: false },
};
