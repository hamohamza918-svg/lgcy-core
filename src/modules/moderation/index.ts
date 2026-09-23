import type { Module } from '../../types/index.js';
import { warnCommand, warningsCommand } from './commands/cases.js';
import { timeoutCommand, untimeoutCommand } from './commands/tempActions.js';
import { kickCommand, banCommand, unbanCommand } from './commands/removal.js';
import {
  purgeCommand,
  slowmodeCommand,
  lockCommand,
  unlockCommand,
} from './commands/channel.js';

/**
 * Moderation module — /warn /warnings /timeout /untimeout /kick /ban /unban
 * /purge /slowmode /lock /unlock. Every action is permission-checked,
 * hierarchy-checked, recorded (moderator + reason + timestamp) as a numbered
 * case, and logged. No action relies on the blanket Administrator permission.
 */
export const moderationModule: Module = {
  name: 'moderation',
  description: 'Full moderation toolkit with case logging.',
  version: '1.0.0',
  defaultEnabled: true,
  dashboard: { icon: '🛡️', section: 'moderation', configurable: true },
  commands: [
    warnCommand,
    warningsCommand,
    timeoutCommand,
    untimeoutCommand,
    kickCommand,
    banCommand,
    unbanCommand,
    purgeCommand,
    slowmodeCommand,
    lockCommand,
    unlockCommand,
  ],
};
