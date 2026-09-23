/**
 * Ticket system tests. Run: `npm run test:tickets`.
 *
 * Covers (per the Phase-1 brief): ticket creation, duplicate prevention,
 * unauthorized claim, claim collision, close confirmation, DB persistence,
 * restart recovery, and transcript generation. These are offline unit tests —
 * no Discord connection is made.
 */
process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= '000000000000000000';
process.env.GUILD_ID ??= '000000000000000000';
// Force an isolated DB (override any DATABASE_PATH that .env set via dotenv), so
// tests never touch the real live database.
process.env.DATABASE_PATH = 'data/test-tickets.sqlite';
process.env.LOG_LEVEL = 'silent';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { initDatabase, closeDatabase } from '../src/database/index.js';
import { ticketsRepo } from '../src/database/repositories/ticketsRepo.js';
import { isTicketStaff, authorizeTicketAction, validateTicketContext } from '../src/modules/tickets/authz.js';
import { slugifyUsername, buildChannelName } from '../src/modules/tickets/naming.js';
import { renderTranscriptHtml } from '../src/modules/tickets/transcript.js';
import { buildCloseConfirmRow } from '../src/modules/tickets/ui.js';

const DB_PATH = resolve(process.cwd(), process.env.DATABASE_PATH!);
const GUILD = 'guild-1';

function wipe() {
  for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`, `${DB_PATH}-journal`]) {
    try { rmSync(f); } catch { /* ignore */ }
  }
}

before(() => { wipe(); initDatabase(); });
after(() => { closeDatabase(); wipe(); });

// ── Channel naming & collision safety ─────────────────────────────────
test('slugifyUsername sanitizes to Discord-safe names', () => {
  assert.equal(slugifyUsername('Hamza!!'), 'hamza');
  assert.equal(slugifyUsername('  '), 'user');
  assert.equal(slugifyUsername('Ghost_99'), 'ghost99');
});

test('buildChannelName avoids collisions using the ticket number', () => {
  const existing = new Set<string>(['ticket-hamza']);
  assert.equal(buildChannelName('ticket', 'Hamza', new Set(), 1), 'ticket-hamza');
  assert.equal(buildChannelName('ticket', 'Hamza', existing, 42), 'ticket-hamza-42');
  assert.equal(buildChannelName('report', 'Hamza', existing, 7), 'report-hamza');
});

// ── Ticket creation + persistence ─────────────────────────────────────
test('ticket creation persists metadata and assigns a number', () => {
  const t = ticketsRepo.create({ guildId: GUILD, openerId: 'user-A', category: 'general', subject: 'Help', description: 'Need help' });
  assert.equal(t.ticketNumber, 1);
  assert.equal(t.status, 'open');
  assert.equal(t.subject, 'Help');
  assert.equal(t.claimedBy, null);
  ticketsRepo.setChannel(t.id, 'chan-A');
  assert.equal(ticketsRepo.getByChannel('chan-A')?.id, t.id);
});

// ── Duplicate prevention ──────────────────────────────────────────────
test('duplicate open ticket of the same category is detectable', () => {
  const dupe = ticketsRepo.findOpenByOpenerCategory(GUILD, 'user-A', 'general');
  assert.ok(dupe, 'existing open general ticket should be found');
  assert.equal(ticketsRepo.findOpenByOpenerCategory(GUILD, 'user-A', 'partner'), null);
});

// ── Authorization: unauthorized claim ─────────────────────────────────
test('unauthorized users cannot claim; staff can', () => {
  assert.equal(isTicketStaff(['role-x'], false, ['role-staff']), false);
  assert.equal(isTicketStaff(['role-staff'], false, ['role-staff']), true);
  assert.equal(isTicketStaff([], true, []), true); // ManageGuild

  // Opener may close/add but NOT claim/transfer/remove.
  assert.equal(authorizeTicketAction('claim', { isStaff: false, isOpener: true }).ok, false);
  assert.equal(authorizeTicketAction('transfer', { isStaff: false, isOpener: true }).ok, false);
  assert.equal(authorizeTicketAction('close', { isStaff: false, isOpener: true }).ok, true);
  assert.equal(authorizeTicketAction('add', { isStaff: false, isOpener: true }).ok, true);
  assert.equal(authorizeTicketAction('claim', { isStaff: true, isOpener: false }).ok, true);
});

test('validateTicketContext rejects cross-guild and wrong-channel abuse', () => {
  const ticket = ticketsRepo.getByChannel('chan-A')!;
  assert.equal(validateTicketContext(null, GUILD, 'chan-A').ok, false); // missing ticket
  assert.equal(validateTicketContext(ticket, 'other-guild', 'chan-A').ok, false); // wrong guild
  assert.equal(validateTicketContext(ticket, GUILD, 'wrong-chan').ok, false); // wrong channel
  assert.equal(validateTicketContext(ticket, GUILD, 'chan-A').ok, true);
});

// ── Claim collision (atomic) ──────────────────────────────────────────
test('claim is atomic — second claimer loses', () => {
  const t = ticketsRepo.create({ guildId: GUILD, openerId: 'user-B', category: 'partner', subject: 'S', description: 'D' });
  assert.equal(ticketsRepo.claim(t.id, 'staff-1'), true);
  assert.equal(ticketsRepo.claim(t.id, 'staff-2'), false, 'double claim must fail');
  assert.equal(ticketsRepo.getById(t.id)?.claimedBy, 'staff-1');
  // Transfer can still reassign.
  assert.equal(ticketsRepo.transfer(t.id, 'staff-2'), true);
  assert.equal(ticketsRepo.getById(t.id)?.claimedBy, 'staff-2');
});

// ── Close confirmation gate exists ────────────────────────────────────
test('close confirmation row offers explicit confirm + cancel', () => {
  const row = buildCloseConfirmRow(99).toJSON() as { components: { custom_id: string }[] };
  const ids = row.components.map((c) => c.custom_id);
  assert.deepEqual(ids, ['tickets:closeYes:99', 'tickets:closeNo:99']);
});

test('close transitions state and blocks re-close and claim-after-close', () => {
  const t = ticketsRepo.create({ guildId: GUILD, openerId: 'user-C', category: 'technical', subject: 'S', description: 'D' });
  assert.equal(ticketsRepo.close(t.id, 'staff-1', 'resolved'), true);
  assert.equal(ticketsRepo.close(t.id, 'staff-1', 'again'), false, 'cannot close twice');
  const closed = ticketsRepo.getById(t.id)!;
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closedBy, 'staff-1');
  assert.equal(closed.closeReason, 'resolved');
  assert.equal(ticketsRepo.claim(t.id, 'staff-2'), false, 'cannot claim a closed ticket');
  assert.equal(ticketsRepo.reopen(t.id), true);
  assert.equal(ticketsRepo.getById(t.id)?.status, 'open');
});

// ── DB persistence + restart recovery ─────────────────────────────────
test('ticket numbers and open state survive a simulated restart', () => {
  const before = ticketsRepo.listOpen(GUILD).length;
  const maxNumber = Math.max(...ticketsRepo.listOpen(GUILD).map((t) => t.ticketNumber), 0);

  // Simulate a restart: close the DB handle and re-open the same file.
  closeDatabase();
  initDatabase();

  const openAfter = ticketsRepo.listOpen(GUILD);
  assert.equal(openAfter.length, before, 'open tickets remain known after restart');

  // Numbers keep incrementing (persisted), not reset to 1.
  const next = ticketsRepo.create({ guildId: GUILD, openerId: 'user-D', category: 'general', subject: 'S', description: 'D' });
  assert.equal(next.ticketNumber, maxNumber + 1);
});

// ── Transcript generation ─────────────────────────────────────────────
test('transcript renders metadata, messages, escaping and attachment links', () => {
  const html = renderTranscriptHtml(
    { ticketNumber: 7, category: 'general', subject: 'Broken <thing>', openerId: 'user-A', guildName: 'LGCY', createdAt: '2026-09-21 10:00:00' },
    [
      { authorTag: 'hamza#0', authorId: 'user-A', authorBot: false, timestampIso: '2026-09-21T10:00:05.000Z', content: 'hello <script>', attachments: [{ name: 'log.txt', url: 'https://cdn/log.txt' }], embedCount: 0 },
      { authorTag: 'LGCY Bot', authorId: 'bot', authorBot: true, timestampIso: '2026-09-21T10:00:06.000Z', content: 'welcome', attachments: [], embedCount: 1 },
    ],
  );
  assert.match(html, /LGCY Ticket #7/);
  assert.match(html, /hamza#0/);
  assert.match(html, /2026-09-21T10:00:05/);
  assert.match(html, /&lt;script&gt;/, 'content must be HTML-escaped');
  assert.match(html, /Broken &lt;thing&gt;/, 'subject must be escaped');
  assert.match(html, /href="https:\/\/cdn\/log.txt"/, 'attachment link present');
  assert.match(html, /BOT/, 'bot badge present');
  assert.match(html, /1 embed/, 'embed count noted');
});
