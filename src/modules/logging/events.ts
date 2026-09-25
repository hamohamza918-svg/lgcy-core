import type { EventHandler } from '../../types/index.js';
import { memberJoinLog, memberLeaveLog, memberUpdateLog, banLog, unbanLog } from './memberLog.js';
import { messageCreateLog, messageDeleteLog, messageEditLog, messageBulkDeleteLog } from './messageLog.js';
import { channelCreateLog, channelDeleteLog, channelUpdateLog, roleCreateLog, roleDeleteLog } from './serverLog.js';
import { voiceStateLog } from './voiceLog.js';

/**
 * All logging event handlers. Each routes to its category channel via sendLog
 * and attributes the actor from the audit log when it can be done reliably
 * (needs the View Audit Log permission) — otherwise shows "unknown", never a
 * guess. Split by domain: member/message/server/voice.
 */
export const loggingEvents: EventHandler[] = [
  // member + moderation
  memberJoinLog,
  memberLeaveLog,
  memberUpdateLog,
  banLog,
  unbanLog,
  // messages
  messageCreateLog,
  messageDeleteLog,
  messageEditLog,
  messageBulkDeleteLog,
  // server (channels + roles)
  channelCreateLog,
  channelDeleteLog,
  channelUpdateLog,
  roleCreateLog,
  roleDeleteLog,
  // voice
  voiceStateLog,
] as EventHandler[];
