/**
 * Control Center tests. Run: `npm run test:control`.
 *
 * Covers: secret redaction, secret storage round-trip, config validation,
 * draft/apply, module toggles (incl. voice lock), role protection, export secret
 * exclusion, and diagnostic sanitization. Fully offline — no Discord, no network.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Force test isolation (override any values .env may have set via dotenv).
process.env.LGCY_DATA_DIR = join(tmpdir(), 'lgcy-control-test-' + process.pid);
process.env.DATABASE_PATH = join(tmpdir(), `lgcy-control-test-${process.pid}.sqlite`);
process.env.LOG_LEVEL = 'silent';
delete process.env.DISCORD_TOKEN;
delete process.env.DISCORD_CLIENT_ID;
delete process.env.GUILD_ID;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';

import { initDatabase, closeDatabase } from '../../src/database/index.js';
import { redactString, redactDeep, REDACTED } from '../../src/services/redact.js';
import { secretStore } from '../../src/services/secretStore.js';
import { configService } from '../server/services/configService.js';
import { moduleService } from '../server/services/moduleService.js';
import { roleService, selfRoleBlockReason } from '../server/services/roleService.js';
import { exportService } from '../server/services/exportService.js';
import { runDiagnostics } from '../server/services/diagnosticsService.js';
import { auditService } from '../server/services/auditService.js';
import { systemHealth } from '../server/services/healthService.js';
import { liveLock } from '../server/services/liveLock.js';
import { connectionService } from '../server/services/connectionService.js';
import { buildProposedMapping } from '../server/services/mappingService.js';
import { applyEngineService } from '../server/services/applyEngineService.js';
import { roleManagerService } from '../server/services/roleManagerService.js';

// Dummy token shaped like a real one (first segment ≥ 20 chars) — NOT a real credential.
const FAKE_TOKEN = 'MTk1NDcxMjM0NTY3ODkwMTIzNDU2Nzg.FAKEfake.this_is_a_dummy_token_value_1234567890';

before(() => { initDatabase(); });
after(() => {
  closeDatabase();
  try { rmSync(process.env.DATABASE_PATH!); } catch { /* ignore */ }
  try { rmSync(process.env.LGCY_DATA_DIR!, { recursive: true }); } catch { /* ignore */ }
});

// ── Secret redaction ──────────────────────────────────────────────────
test('redactString masks token-shaped values', () => {
  const s = `token is ${FAKE_TOKEN} ok`;
  assert.ok(!redactString(s).includes(FAKE_TOKEN));
  assert.ok(redactString(s).includes(REDACTED));
});

test('redactDeep masks secret-named keys and nested tokens', () => {
  const out = redactDeep({ token: FAKE_TOKEN, nested: { password: 'hunter2', note: `x ${FAKE_TOKEN}` }, safe: 'ok' });
  assert.equal(out.token, REDACTED);
  assert.equal(out.nested.password, REDACTED);
  assert.ok(!JSON.stringify(out).includes(FAKE_TOKEN));
  assert.equal(out.safe, 'ok');
});

// ── Secret storage ────────────────────────────────────────────────────
test('secret store round-trips the token and never exposes it in meta', () => {
  secretStore.setToken(FAKE_TOKEN);
  assert.equal(secretStore.getToken(), FAKE_TOKEN);
  const meta = secretStore.meta();
  assert.equal(meta.hasToken, true);
  assert.ok(!JSON.stringify(meta).includes(FAKE_TOKEN), 'meta must not contain the token');
  assert.ok(!('token' in meta));
});

test('secret store rejects an obviously invalid token', () => {
  assert.throws(() => secretStore.setToken('short'));
});

// ── Config validation + draft/apply ──────────────────────────────────
test('config validation rejects bad types', () => {
  assert.throws(() => configService.saveDraft({ ticketDeleteDelay: 'not-a-number' }));
});

test('draft → diff → apply cycle works and clears the draft', () => {
  configService.discardDraft();
  configService.saveDraft({ welcomeChannelId: '900000000000000101' });
  assert.equal(configService.hasDraft(), true);
  const diff = configService.diff();
  assert.ok(diff.some((c) => c.path === 'welcomeChannelId'));
  const applied = configService.apply();
  assert.equal(applied.welcomeChannelId, '900000000000000101');
  assert.equal(configService.hasDraft(), false, 'draft cleared after apply');
  assert.equal(configService.getApplied().welcomeChannelId, '900000000000000101');
});

// ── Module toggles ────────────────────────────────────────────────────
test('module toggle enables/disables, but voice stays locked', () => {
  const off = moduleService.setEnabled('welcome', false);
  assert.equal(off.enabled, false);
  const on = moduleService.setEnabled('welcome', true);
  assert.equal(on.enabled, true);
  assert.throws(() => moduleService.setEnabled('voice', true), /locked/i);
});

// ── Role protection (mirrors the bot's self-role guard) ──────────────
test('role protection blocks staff/managed/admin/above-bot, allows game roles', () => {
  const bot = 90;
  assert.ok(selfRoleBlockReason({ id: '1', name: 'Admin', color: 0, position: 98, managed: false, memberCount: 1, hasAdministrator: true }, bot, []));
  assert.ok(selfRoleBlockReason({ id: '2', name: 'Moderator', color: 0, position: 95, managed: false, memberCount: 1, hasAdministrator: false }, bot, []));
  assert.ok(selfRoleBlockReason({ id: '3', name: 'Nitro Booster', color: 0, position: 5, managed: true, memberCount: 1, hasAdministrator: false }, bot, []));
  assert.ok(selfRoleBlockReason({ id: '4', name: 'AboveBot', color: 0, position: 95, managed: false, memberCount: 1, hasAdministrator: false }, bot, []));
  assert.equal(selfRoleBlockReason({ id: '5', name: 'FiveM', color: 0, position: 40, managed: false, memberCount: 1, hasAdministrator: false }, bot, []), null);
});

test('roleService.checkAddSelfRole refuses a staff role and allows a game role (mock data)', async () => {
  const staff = await roleService.checkAddSelfRole('800000000000000003'); // Admin
  assert.equal(staff.ok, false);
  const game = await roleService.checkAddSelfRole('800000000000000020'); // FiveM
  assert.equal(game.ok, true);
});

// ── Export secret exclusion ──────────────────────────────────────────
test('config export never contains the token', () => {
  secretStore.setToken(FAKE_TOKEN);
  const payload = JSON.stringify(exportService.build());
  assert.ok(!payload.includes(FAKE_TOKEN), 'export must not contain the token');
  assert.ok(!/"token"\s*:\s*"[^"]{20,}"/.test(payload), 'export must not contain a token field');
});

// ── Diagnostic sanitization ──────────────────────────────────────────
test('diagnostic report contains no token even when one is stored', async () => {
  secretStore.setToken(FAKE_TOKEN);
  const report = JSON.stringify(await runDiagnostics());
  assert.ok(!report.includes(FAKE_TOKEN), 'diagnostics must be sanitized');
});

// ── Secret provider info (no secrets exposed) ────────────────────────
test('provider info reports status and never leaks token/key/blob', () => {
  secretStore.setToken(FAKE_TOKEN);
  const meta = secretStore.meta();
  assert.ok(['SECURE', 'INSECURE', 'BLOCKED'].includes(meta.provider.status));
  const json = JSON.stringify(meta);
  assert.ok(!json.includes(FAKE_TOKEN));
  assert.ok(!/ciphertext|"iv"|secret\.key/.test(json), 'no key/blob material in meta');
  if (meta.provider.secure) assert.ok(['dpapi', 'aes-256-gcm'].includes(meta.provider.provider));
});

// ── Audit trail (never stores secrets) ───────────────────────────────
test('audit records actions and redacts secret-shaped details', () => {
  auditService.record('Test action', { module: 'test', result: 'ok', detail: `leaked ${FAKE_TOKEN}` });
  const entries = auditService.list(10);
  assert.ok(entries.length > 0);
  const found = entries.find((e) => e.action === 'Test action');
  assert.ok(found);
  assert.ok(!JSON.stringify(entries).includes(FAKE_TOKEN), 'audit must not store the token');
});

// ── Config history snapshot + restore-to-draft ───────────────────────
test('applying config snapshots history and a revision can be staged as a draft', () => {
  configService.discardDraft();
  configService.saveDraft({ rulesChannelId: '900000000000000102' });
  configService.apply();
  const revs = configService.history();
  assert.ok(revs.length > 0, 'a revision is saved before apply');
  const { draft } = configService.restoreToDraft(revs[0]!.id);
  assert.ok(draft, 'restore stages a draft');
  assert.equal(configService.hasDraft(), true);
  configService.discardDraft();
});

// ── Overall system health ────────────────────────────────────────────
test('system health derives one overall status', async () => {
  const h = await systemHealth();
  assert.ok(['HEALTHY', 'WARNING', 'ERROR'].includes(h.status));
  assert.equal(typeof h.counts.ok, 'number');
});

// ── LIVE mutation lock ───────────────────────────────────────────────
test('live mutations are locked by default and assert() throws 423', () => {
  delete process.env.LGCY_ALLOW_MUTATIONS;
  assert.equal(liveLock.isLocked(), true);
  assert.equal(liveLock.status().locked, true);
  try {
    liveLock.assert('Deploy commands');
    assert.fail('expected lock to throw');
  } catch (e) {
    const err = e as Error & { statusCode?: number };
    assert.match(err.message, /LOCKED/);
    assert.equal(err.statusCode, 423);
  }
});

// ── Proposed mapping (read-only, from mock data) ─────────────────────
test('proposed mapping is generated from existing objects and applies nothing', async () => {
  const m = await buildProposedMapping();
  assert.ok(m.start && m.selfRoles && m.tickets && m.logs);
  // The mock server has a FiveM role → it should be matched by name.
  assert.ok(m.selfRoles.FiveM && m.selfRoles.FiveM.name.toLowerCase().includes('fivem'));
  assert.ok(Array.isArray(m.suggestedStaffRoles) && m.suggestedStaffRoles.length > 0);
  assert.match(m.note, /nothing has been written/i);
});

// ── Credential test is safe with no token (no network) ───────────────
test('testCredentials returns a safe result and makes no network call without a token', async () => {
  secretStore.clearToken();
  const res = await connectionService.testCredentials();
  assert.equal(res.ok, false);
  assert.match(res.message, /token/i);
});

// ── Apply Engine: permission op grouping (Phase 2 / 3B) ──────────────
test('permissionOps splits into approval groups and holds Developer Administrator', () => {
  if (!roleManagerService.available()) return;
  const ops = applyEngineService.permissionOps();
  const count = (g: string) => ops.filter((o) => o.group === g).reduce((n, o) => n + o.remove.length + o.add.length, 0);
  assert.equal(count('3b1'), 5, '3b1 = 5 MentionEveryone removals');
  assert.equal(count('3b2-safe'), 5, '3b2-safe = 5 ops');
  assert.equal(count('3b2-review'), 27, '3b2-review = 27 ops');
  assert.ok(count('3b3') >= 13, '3b3 management ops');
  // Developer (Administrator) is intentionally NOT in any group — held.
  assert.ok(!ops.some((o) => o.roleId === '1534981496912351474'), 'Developer must be excluded (Admin held)');
});

// ── Apply Engine: stage-aware, idempotent, drift-protecting ──────────
// Regression for the 3B-1 false-abort: after a completed/MANUAL Stage 3A whose
// reindexed hierarchy was accepted into the checkpoint, a permission-only stage
// must NOT re-validate the legacy hierarchy MOVE plans (whose stale from/to no
// longer match live). Whole-state drift protection must remain fully intact.
const THREE_B_ONE = ['1534981591250505749', '1534981598351724634', '1534981560275828917', '1534981519041499196', '1534981541296603438'];

test('validateLive is stage-scoped: a perms stage ignores unrelated hierarchy plans but keeps full drift protection', () => {
  if (!roleManagerService.available()) return;

  // Build an accepted baseline that DIVERGES from the audit-derived plan, exactly
  // like the real post-Stage-3A state: a role sits at a position matching NEITHER
  // its plan MOVE `from` (audit position) NOR its `to` (target rank). Written to a
  // temp checkpoint (temp DB — never touches production).
  const audit = roleManagerService.loadAudit();
  const base = structuredClone(audit.roles);
  const moveOps = applyEngineService.buildOps().filter((o) => o.type === 'MOVE');
  const firstMove = moveOps[0];
  if (!firstMove) return; // plan has no hierarchy moves — nothing to regress
  const movedId = firstMove.roleId;
  const moved = base.find((r) => r.id === movedId)!;
  moved.position = 9999; // neither its audit position nor its plan target

  const cpPath = join(tmpdir(), `lgcy-test-cp-${process.pid}.json`);
  writeFileSync(cpPath, JSON.stringify({ roles: base }));
  applyEngineService.setCheckpoint(cpPath);
  assert.ok(applyEngineService.getCheckpoint(), 'temp checkpoint must load');
  const clone = () => structuredClone(base);
  const has3b1 = applyEngineService.permissionOps().some((o) => o.group === '3b1');

  // A) The LEGACY (stageless) path evaluates the whole plan, so the stale MOVE
  //    target for the reindexed role is (correctly, for that path) unexpected —
  //    this is the false-abort a perms stage used to inherit.
  const legacy = applyEngineService.validateLive(clone());
  assert.equal(legacy.ok, false, 'legacy path evaluates hierarchy MOVE plans');
  assert.ok(legacy.drift.some((d) => /MOVE/i.test(d)), 'legacy reports the stale MOVE as drift');

  // B) THE FIX: perms:3b1 does NOT re-validate hierarchy MOVE plans. Same live
  //    state → NO drift. Only current-stage (PERM) ops are classified.
  const b = applyEngineService.validateLive(clone(), 'perms:3b1');
  assert.equal(b.ok, true, 'accepted hierarchy must not false-abort a perms stage');
  assert.ok(!b.drift.some((d) => /MOVE|position changed/i.test(d)), 'no hierarchy drift in a clean perms stage');
  assert.ok([...b.pending, ...b.alreadyApplied].every((s) => s.startsWith('PERM ')), 'only perms ops classified in a perms stage');
  if (has3b1) assert.ok(b.pending.filter((s) => s.startsWith('PERM ')).length >= 1, 'pending 3b1 perms expected');

  // C) Idempotent: 3b1 removals already applied → ALREADY-APPLIED, not drift; the
  //    expected perm delta on the target roles is NOT counted as whole-state drift.
  if (has3b1) {
    const applied = clone().map((r) =>
      THREE_B_ONE.includes(r.id) ? { ...r, permissions: (r.permissions ?? []).filter((p) => p !== 'MentionEveryone') } : r);
    const c = applyEngineService.validateLive(applied, 'perms:3b1');
    assert.equal(c.ok, true, 'already-applied perms must not abort');
    assert.ok(c.alreadyApplied.some((s) => s.startsWith('PERM ')), 'already-applied perms reported');
  }

  // D) Real HIERARCHY drift still aborts, even during a perms stage (live != checkpoint).
  const posDrift = clone();
  posDrift.find((r) => !r.isEveryone && !r.managed && r.id !== movedId)!.position += 1000;
  const d = applyEngineService.validateLive(posDrift, 'perms:3b1');
  assert.equal(d.ok, false, 'position drift must abort in any stage');
  assert.ok(d.drift.some((x) => /position changed/.test(x)));

  // E) Real PERMISSION drift on an UNRELATED role still aborts.
  const permDrift = clone();
  permDrift.find((r) => !r.isEveryone && !r.managed && !THREE_B_ONE.includes(r.id))!
    .permissions = ['Administrator'];
  const e = applyEngineService.validateLive(permDrift, 'perms:3b1');
  assert.equal(e.ok, false, 'unrelated permission drift must abort');
  assert.ok(e.drift.some((x) => /permissions changed/.test(x)));

  // F) Real MEMBER drift still aborts.
  const memDrift = clone();
  const m = memDrift.find((r) => !r.isEveryone && !r.managed)!;
  m.members = [...(m.members ?? []), '999999999999999999'];
  const f = applyEngineService.validateLive(memDrift, 'perms:3b1');
  assert.equal(f.ok, false, 'member drift must abort');
  assert.ok(f.drift.some((x) => /member assignments changed/.test(x)));

  rmSync(cpPath, { force: true });
});
