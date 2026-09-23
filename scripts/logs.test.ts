/**
 * Audit-attribution tests for the upgraded logs. Run: `npm run test:logs`.
 * Pure logic only — no Discord, no network.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATABASE_PATH = join(tmpdir(), `lgcy-logs-test-${process.pid}.sqlite`);
process.env.LGCY_DATA_DIR = join(tmpdir(), `lgcy-logs-test-${process.pid}`);
process.env.LOG_LEVEL = 'silent';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickActor, actorSuffix, byLine, type AuditLike } from '../src/modules/logging/shared.js';

const T = 1_700_000_000_000;
const entry = (over: Partial<AuditLike> = {}): AuditLike => ({
  executorId: 'mod1', executorTag: 'Mod#1', targetId: 'user1', createdTimestamp: T, reason: null, changeKeys: [], ...over,
});

test('pickActor: exactly one in-window target match → that actor', () => {
  const a = pickActor([entry()], { now: T + 500, targetId: 'user1' });
  assert.deepEqual(a, { id: 'mod1', tag: 'Mod#1' });
});

test('pickActor: passes reason through', () => {
  const a = pickActor([entry({ reason: 'spam' })], { now: T, targetId: 'user1' });
  assert.equal(a?.reason, 'spam');
});

test('pickActor: never guesses — none / multiple / stale / wrong target → null', () => {
  assert.equal(pickActor([], { now: T }), null);
  assert.equal(pickActor([entry({ executorId: 'a' }), entry({ executorId: 'b' })], { now: T, targetId: 'user1' }), null);
  assert.equal(pickActor([entry({ createdTimestamp: T - 60_000 })], { now: T, targetId: 'user1' }), null);
  assert.equal(pickActor([entry({ targetId: 'someone-else' })], { now: T, targetId: 'user1' }), null);
});

test('pickActor: requireChangeKey filters non-matching entries', () => {
  assert.equal(pickActor([entry({ changeKeys: ['nick'] })], { now: T, targetId: 'user1', requireChangeKey: 'communication_disabled_until' }), null);
  assert.ok(pickActor([entry({ changeKeys: ['communication_disabled_until'] })], { now: T, targetId: 'user1', requireChangeKey: 'communication_disabled_until' }));
});

test('suffix helpers render mod vs unknown without guessing', () => {
  assert.equal(actorSuffix({ id: 'm', tag: 'Mod#1', reason: 'rude' }), 'by **Mod#1** · rude');
  assert.equal(actorSuffix(null), 'by an unknown moderator');
  assert.equal(byLine({ id: 'm', tag: 'Ghost' }), 'by **Ghost**');
  assert.equal(byLine(null), 'by unknown');
});
