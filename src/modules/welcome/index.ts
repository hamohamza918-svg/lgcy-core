import type { Module } from '../../types/index.js';
import { guildMemberAddEvent, guildMemberRemoveEvent } from './events.js';
import { welcomeCommand } from './commands.js';

/**
 * Welcome module — generates a custom graphical LGCY welcome card on join,
 * posts a configurable embed, optionally DMs the new member, and announces
 * departures. Enabled by default; posts nothing until a welcome channel is
 * configured, so it's safe to ship on.
 */
export const welcomeModule: Module = {
  name: 'welcome',
  description: 'Graphical welcome cards, join/leave messages, and optional join DM.',
  version: '1.0.0',
  defaultEnabled: true,
  dashboard: { icon: '👋', section: 'welcome', configurable: true },
  commands: [welcomeCommand],
  events: [guildMemberAddEvent, guildMemberRemoveEvent],
};

export { generateWelcomeCard } from './card.js';
