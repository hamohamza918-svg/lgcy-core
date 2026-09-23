import type { Module } from '../../types/index.js';
import { loggingEvents } from './events.js';
import { loggingCommand } from './commands.js';

/**
 * Logging module — configurable audit logging for joins/leaves, message
 * delete/edit, role & nickname changes, bans/unbans, voice activity, and
 * channel changes. Each category routes to its own configurable channel, so one
 * giant channel never gets spammed. Logs nothing until channels are configured.
 */
export const loggingModule: Module = {
  name: 'logging',
  description: 'Per-category audit logging to configurable channels.',
  version: '1.0.0',
  defaultEnabled: true,
  dashboard: { icon: '📝', section: 'logging', configurable: true },
  commands: [loggingCommand],
  events: loggingEvents,
};
