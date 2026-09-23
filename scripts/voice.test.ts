/**
 * Voice-logging tests. Run: `npm run test:voice`.
 * Pure logic only — no Discord, no network. Covers classification, session
 * tracking, durations, member counts, state transitions, cleanup, duplicate
 * protection, and moderator-attribution safety.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Isolate any incidental DB access to a temp path (pure funcs don't touch it).
process.env.DATABASE_PATH = join(tmpdir(), `lgcy-voice-test-${process.pid}.sqlite`);
process.env.LGCY_DATA_DIR = join(tmpdir(), `lgcy-voice-test-${process.pid}`);
process.env.LOG_LEVEL = 'silent';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyVoiceEvent,
  formatDuration,
  attributeVoiceModerator,
  classifyModAttribution,
  renderJoinEmbed,
  renderMoveEmbed,
  renderSessionSummaryEmbed,
  renderStateEmbed,
  renderModEmbed,
  type VoiceStateLike,
} from '../src/modules/logging/voiceLog.js';
import {
  startSession,
  recordMove,
  endSession,
  recordChannelSize,
  getSession,
  sessionCount,
  clearAllSessions,
} from '../src/services/voiceSessions.js';

const T0 = 1_700_000_000_000;
const base: VoiceStateLike = {
  channelId: null, selfMute: false, selfDeaf: false,
  serverMute: false, serverDeaf: false, streaming: false, selfVideo: false,
};
const inCh = (id: string, over: Partial<VoiceStateLike> = {}): VoiceStateLike => ({ ...base, channelId: id, ...over });
const fields = (e: { toJSON(): { fields?: { name: string; value: string }[] } }) =>
  Object.fromEntries((e.toJSON().fields ?? []).map((f) => [f.name, f.value]));

// ── Classification ──────────────────────────────────────────────────
test('classify: join / leave / move', () => {
  assert.deepEqual(classifyVoiceEvent(base, inCh('A')), { kind: 'join', channelId: 'A' });
  assert.deepEqual(classifyVoiceEvent(inCh('A'), base), { kind: 'leave', channelId: 'A' });
  assert.deepEqual(classifyVoiceEvent(inCh('A'), inCh('B')), { kind: 'move', from: 'A', to: 'B' });
});

test('classify: mute / deafen transitions', () => {
  const r1 = classifyVoiceEvent(inCh('A'), inCh('A', { selfMute: true }));
  assert.deepEqual(r1, { kind: 'state', channelId: 'A', changes: ['selfMuteOn'] });
  const r2 = classifyVoiceEvent(inCh('A', { selfMute: true }), inCh('A'));
  assert.deepEqual(r2, { kind: 'state', channelId: 'A', changes: ['selfMuteOff'] });
  const r3 = classifyVoiceEvent(inCh('A'), inCh('A', { selfDeaf: true }));
  assert.deepEqual(r3, { kind: 'state', channelId: 'A', changes: ['selfDeafOn'] });
  const r4 = classifyVoiceEvent(inCh('A'), inCh('A', { serverMute: true }));
  assert.deepEqual(r4, { kind: 'state', channelId: 'A', changes: ['serverMuteOn'] });
});

test('classify: camera / stream transitions', () => {
  assert.deepEqual(classifyVoiceEvent(inCh('A'), inCh('A', { selfVideo: true })), { kind: 'state', channelId: 'A', changes: ['cameraOn'] });
  assert.deepEqual(classifyVoiceEvent(inCh('A', { streaming: true }), inCh('A')), { kind: 'state', channelId: 'A', changes: ['streamOff'] });
});

test('classify: no meaningful change → none (duplicate-event protection)', () => {
  assert.deepEqual(classifyVoiceEvent(inCh('A'), inCh('A')), { kind: 'none' });
  assert.deepEqual(classifyVoiceEvent(base, base), { kind: 'none' });
});

// ── Session tracking ────────────────────────────────────────────────
test('session: join then leave computes duration and cleans up', () => {
  clearAllSessions();
  startSession('g', 'u', 'A', T0);
  assert.equal(sessionCount(), 1);
  const end = endSession('g', 'u', T0 + 74_000);
  assert.ok(end);
  assert.equal(end!.totalDurationMs, 74_000);
  assert.equal(end!.moveCount, 0);
  assert.equal(getSession('g', 'u'), null); // cleaned up
  assert.equal(sessionCount(), 0);
});

test('session: single move records from-channel + time in previous', () => {
  clearAllSessions();
  startSession('g', 'u', 'A', T0);
  const mv = recordMove('g', 'u', 'B', T0 + 74_000);
  assert.equal(mv.fromChannelId, 'A');
  assert.equal(mv.timeInPreviousMs, 74_000);
  assert.equal(mv.moveNumber, 1);
  assert.equal(mv.session.currentChannelId, 'B');
});

test('session: multiple moves track count + channel history', () => {
  clearAllSessions();
  startSession('g', 'u', 'A', T0);
  recordMove('g', 'u', 'B', T0 + 10_000);
  recordMove('g', 'u', 'C', T0 + 25_000);
  const end = endSession('g', 'u', T0 + 40_000);
  assert.equal(end!.moveCount, 2);
  assert.deepEqual(end!.session.channelsVisited, ['A', 'B', 'C']);
  assert.equal(end!.totalDurationMs, 40_000);
});

test('session: duplicate join is idempotent; same-channel move does not count', () => {
  clearAllSessions();
  const s1 = startSession('g', 'u', 'A', T0);
  const s2 = startSession('g', 'u', 'A', T0 + 5_000); // duplicate join event
  assert.equal(s1, s2);
  assert.equal(sessionCount(), 1);
  assert.equal(s1.joinedAt, T0); // not reset
  const mv = recordMove('g', 'u', 'A', T0 + 6_000); // "move" to same channel
  assert.equal(mv.moveNumber, 0); // no increment
});

test('session: endSession with no session returns null', () => {
  clearAllSessions();
  assert.equal(endSession('g', 'nobody', T0), null);
});

// ── Durations ───────────────────────────────────────────────────────
test('formatDuration is compact', () => {
  assert.equal(formatDuration(74_000), '1m 14s');
  assert.equal(formatDuration(45_000), '45s');
  assert.equal(formatDuration(3_723_000), '1h 2m');
  assert.equal(formatDuration(500), '0s');
});

// ── Member counts in embeds ─────────────────────────────────────────
test('member counts render before → after', () => {
  const join = renderJoinEmbed({
    username: 'x', channelName: 'LGCY 3', channelId: 'A', userId: 'u',
    countBefore: 2, countAfter: 3, selfMute: false, selfDeaf: false,
    timestampSec: T0 / 1000, includeIds: false, showCounts: true,
  });
  assert.equal(fields(join)['Members'], '2 → 3');

  const move = renderMoveEmbed({
    username: 'x', fromName: 'LGCY 3', fromId: 'A', toName: 'LGCY 2', toId: 'B', userId: 'u',
    timeInPreviousMs: 74_000, fromBefore: 3, fromAfter: 2, toBefore: 1, toAfter: 2,
    joinedAtSec: T0 / 1000, moveNumber: 2, timestampSec: T0 / 1000, includeIds: false,
    showCounts: true, showDuration: true,
  });
  assert.equal(fields(move)['Members'], 'LGCY 3: 3 → 2\nLGCY 2: 1 → 2');
  assert.equal(fields(move)['Time in previous channel'], '1m 14s');
});

test('includeIds toggles the footer', () => {
  const off = renderJoinEmbed({ username: 'x', channelName: 'A', channelId: 'cid', userId: 'uid', countBefore: 0, countAfter: 1, selfMute: false, selfDeaf: false, timestampSec: 1, includeIds: false, showCounts: true });
  assert.equal(off.toJSON().footer, undefined);
  const on = renderJoinEmbed({ username: 'x', channelName: 'A', channelId: 'cid', userId: 'uid', countBefore: 0, countAfter: 1, selfMute: false, selfDeaf: false, timestampSec: 1, includeIds: true, showCounts: true });
  assert.match(on.toJSON().footer!.text, /uid/);
  assert.match(on.toJSON().footer!.text, /cid/);
});

test('session summary shows duration, moves, route, peak', () => {
  const e = renderSessionSummaryEmbed({
    username: 'x', channelId: 'B', userId: 'u', routeNames: ['LGCY 3', 'LGCY 2', 'LGCY 3'],
    sessionDurationMs: 3_723_000, moveCount: 2, peakChannelSize: 6,
    joinedAtSec: 1, leftAtSec: 2, includeIds: false, showCounts: true, showDuration: true,
  });
  const f = fields(e);
  assert.equal(f['⏱️ Duration'], '1h 2m');
  assert.equal(f['🔀 Moves'], '2');
  assert.equal(f['👥 Peak channel size'], '6');
  assert.equal(f['🗺️ Route'], '🔊 LGCY 3 → 🔊 LGCY 2 → 🔊 LGCY 3');
});

test('peak channel size tracks the max seen during a session', () => {
  clearAllSessions();
  startSession('g', 'u', 'A', T0, 2);
  recordChannelSize('g', 'A', 6);
  recordChannelSize('g', 'A', 3); // smaller — ignored
  const end = endSession('g', 'u', T0 + 1000);
  assert.equal(end!.session.peakChannelSize, 6);
});

test('state embed shows OFF → ON transition and who did it', () => {
  const e = renderStateEmbed({ username: 'ghost', channelName: 'A', channelId: 'A', userId: 'u', name: 'Screen Share', emoji: '🖥️', on: true, title: 'Started Screen Share', verb: 'started screen sharing', timestampSec: 1, includeIds: false });
  assert.equal(fields(e)['Screen Share'], '🖥️ OFF → ON');
  assert.equal(e.toJSON().description, '**ghost** started screen sharing');
});

test('mod embed states who did what to whom; unknown moderator is not guessed', () => {
  const known = renderModEmbed({ username: 'noob', userId: 'u', action: 'moved', fromName: 'A', toName: 'AFK', moderatorTag: 'GhostAdmin', moderatorId: 'm', timestampSec: 1, includeIds: false });
  assert.equal(known.toJSON().description, '**GhostAdmin** moved **noob**');
  const unknown = renderModEmbed({ username: 'noob', userId: 'u', action: 'disconnected', channelName: 'A', moderatorTag: 'Unknown', timestampSec: 1, includeIds: false });
  assert.equal(unknown.toJSON().description, '**noob** was disconnected by an unknown moderator');
});

test('classifyModAttribution distinguishes self / mod / unknown', () => {
  assert.deepEqual(classifyModAttribution([], { now: T0 }), { status: 'self' });
  assert.deepEqual(
    classifyModAttribution([{ executorId: 'm', executorTag: 'M#1', createdTimestamp: T0, extraChannelId: 'B' }], { now: T0 + 100, channelId: 'B' }),
    { status: 'mod', id: 'm', tag: 'M#1' },
  );
  assert.deepEqual(
    classifyModAttribution([
      { executorId: 'm1', createdTimestamp: T0, extraChannelId: 'B' },
      { executorId: 'm2', createdTimestamp: T0, extraChannelId: 'B' },
    ], { now: T0, channelId: 'B' }),
    { status: 'unknown' },
  );
  // stale entry → no in-window candidate → treated as self, not a guess
  assert.deepEqual(classifyModAttribution([{ executorId: 'm', createdTimestamp: T0 - 60_000, extraChannelId: 'B' }], { now: T0, channelId: 'B' }), { status: 'self' });
});

test('move embed names the mover (self vs unknown)', () => {
  const mk = (moverNote: string) => renderMoveEmbed({
    username: 'ghost', fromName: 'A', fromId: 'a', toName: 'B', toId: 'b', userId: 'u',
    timeInPreviousMs: 1000, fromBefore: 2, fromAfter: 1, toBefore: 0, toAfter: 1, joinedAtSec: 1, moveNumber: 1,
    timestampSec: 1, includeIds: false, showCounts: true, showDuration: true, moverNote,
  }).toJSON().description;
  assert.equal(mk('**ghost** moved themselves'), '**ghost** moved themselves');
  assert.equal(mk('Moved by: unknown'), 'Moved by: unknown');
});

test('mod attribution matches target user and passes the reason through', () => {
  const r = attributeVoiceModerator([
    { executorId: 'm', executorTag: 'M#1', targetId: 'u', createdTimestamp: T0, reason: 'afk move' },
    { executorId: 'x', executorTag: 'X', targetId: 'other', createdTimestamp: T0 },
  ], { now: T0 + 100, targetId: 'u' });
  assert.equal(r?.id, 'm');
  assert.equal(r?.reason, 'afk move');
});

// ── Moderator attribution safety ────────────────────────────────────
test('mod attribution: one in-window entry attributes reliably', () => {
  const r = attributeVoiceModerator(
    [{ executorId: 'mod1', executorTag: 'Mod#1', createdTimestamp: T0, extraChannelId: 'B' }],
    { now: T0 + 500, channelId: 'B' },
  );
  assert.deepEqual(r, { id: 'mod1', tag: 'Mod#1' });
});

test('mod attribution FAILURE cases → null (never guess)', () => {
  // none
  assert.equal(attributeVoiceModerator([], { now: T0 }), null);
  // stale (outside window)
  assert.equal(attributeVoiceModerator([{ executorId: 'm', createdTimestamp: T0 - 60_000, extraChannelId: 'B' }], { now: T0, channelId: 'B' }), null);
  // ambiguous (two candidates)
  assert.equal(attributeVoiceModerator([
    { executorId: 'm1', createdTimestamp: T0, extraChannelId: 'B' },
    { executorId: 'm2', createdTimestamp: T0, extraChannelId: 'B' },
  ], { now: T0, channelId: 'B' }), null);
  // wrong channel
  assert.equal(attributeVoiceModerator([{ executorId: 'm', createdTimestamp: T0, extraChannelId: 'X' }], { now: T0, channelId: 'B' }), null);
});

test('mod embed shows Unknown moderator without guessing', () => {
  const e = renderModEmbed({ username: 'x', userId: 'u', action: 'disconnected', channelName: 'A', channelId: 'A', moderatorTag: 'Unknown', timestampSec: 1, includeIds: false });
  assert.equal(fields(e)['Moderator'], 'Unknown');
});
