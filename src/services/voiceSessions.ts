/**
 * In-memory voice-session tracker. Records where a member is in voice and for
 * how long, so the logging module can report session duration, time-in-channel,
 * move count, channel route and peak channel size. Sessions are ephemeral: they
 * are created on join, updated on move, and DELETED when the member fully leaves
 * voice — no permanent history is persisted (observability only).
 *
 * All functions take an explicit `now` (ms epoch) so timing is deterministic and
 * testable.
 */

export interface VoiceSession {
  userId: string;
  guildId: string;
  initialChannelId: string;
  currentChannelId: string;
  /** When the member first joined voice this session. */
  joinedAt: number;
  /** When the member entered the CURRENT channel (for time-in-channel). */
  lastChannelJoinedAt: number;
  moveCount: number;
  channelsVisited: string[];
  /** Largest channel size observed while the member was present this session. */
  peakChannelSize: number;
}

export interface MoveResult {
  session: VoiceSession;
  fromChannelId: string;
  timeInPreviousMs: number;
  moveNumber: number;
}

export interface EndResult {
  session: VoiceSession;
  totalDurationMs: number;
  moveCount: number;
}

const sessions = new Map<string, VoiceSession>();
const key = (guildId: string, userId: string) => `${guildId}:${userId}`;

export function startSession(
  guildId: string,
  userId: string,
  channelId: string,
  now: number,
  channelSize = 1,
): VoiceSession {
  const k = key(guildId, userId);
  const existing = sessions.get(k);
  if (existing && existing.currentChannelId === channelId) return existing; // duplicate join
  const session: VoiceSession = {
    userId,
    guildId,
    initialChannelId: channelId,
    currentChannelId: channelId,
    joinedAt: now,
    lastChannelJoinedAt: now,
    moveCount: 0,
    channelsVisited: [channelId],
    peakChannelSize: Math.max(1, channelSize),
  };
  sessions.set(k, session);
  return session;
}

export function recordMove(
  guildId: string,
  userId: string,
  toChannelId: string,
  now: number,
): MoveResult {
  const k = key(guildId, userId);
  const existing = sessions.get(k);
  if (!existing) {
    const session = startSession(guildId, userId, toChannelId, now);
    return { session, fromChannelId: toChannelId, timeInPreviousMs: 0, moveNumber: 0 };
  }
  const fromChannelId = existing.currentChannelId;
  const timeInPreviousMs = now - existing.lastChannelJoinedAt;
  if (fromChannelId === toChannelId) {
    return { session: existing, fromChannelId, timeInPreviousMs, moveNumber: existing.moveCount };
  }
  existing.currentChannelId = toChannelId;
  existing.lastChannelJoinedAt = now;
  existing.moveCount += 1;
  existing.channelsVisited.push(toChannelId);
  return { session: existing, fromChannelId, timeInPreviousMs, moveNumber: existing.moveCount };
}

export function endSession(guildId: string, userId: string, now: number): EndResult | null {
  const k = key(guildId, userId);
  const session = sessions.get(k);
  if (!session) return null;
  sessions.delete(k);
  return { session, totalDurationMs: now - session.joinedAt, moveCount: session.moveCount };
}

/**
 * Updates the peak channel size for every session currently in a channel. Called
 * whenever a channel's membership changes so "peak channel size" reflects the
 * true maximum a member was part of, not just the size when they entered.
 */
export function recordChannelSize(guildId: string, channelId: string, size: number): void {
  for (const s of sessions.values()) {
    if (s.guildId === guildId && s.currentChannelId === channelId && size > s.peakChannelSize) {
      s.peakChannelSize = size;
    }
  }
}

export function getSession(guildId: string, userId: string): VoiceSession | null {
  return sessions.get(key(guildId, userId)) ?? null;
}
export function sessionCount(): number {
  return sessions.size;
}
export function clearAllSessions(): void {
  sessions.clear();
}
