/**
 * One-off cleanup: removes leftover UNIT-TEST ticket rows from the live DB.
 *
 * Test rows are identified ONLY by having a non-numeric guild_id (e.g. 'guild-1'),
 * which a real Discord guild ID (an all-digit snowflake) can never be. Real
 * tickets are never matched. Read-only until it prints the plan, then deletes.
 *
 * Run with the bot STOPPED:  npx tsx scripts/cleanup-test-tickets.ts
 */
import { initDatabase, getDb, closeDatabase } from '../src/database/index.js';

/* eslint-disable no-console */
initDatabase();
const db = getDb();

// Show every guild_id present in tickets so nothing is a surprise.
const byGuild = db
  .prepare("SELECT guild_id, COUNT(*) AS total, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM tickets GROUP BY guild_id")
  .all() as { guild_id: string; total: number; open: number }[];

console.log('\nTickets by guild_id:');
for (const r of byGuild) {
  const isReal = /^[0-9]{15,20}$/.test(r.guild_id);
  console.log(`  ${isReal ? '✅ real ' : '🧪 test '} ${r.guild_id.padEnd(22)} total=${r.total} open=${r.open}`);
}

const victims = db
  .prepare("SELECT id, guild_id, opener_id, ticket_number FROM tickets WHERE guild_id NOT GLOB '[0-9]*'")
  .all() as { id: number; guild_id: string; opener_id: string; ticket_number: number }[];

if (victims.length === 0) {
  console.log('\nNothing to clean — no non-numeric (test) guild rows found.\n');
  closeDatabase();
  process.exit(0);
}

console.log(`\nDeleting ${victims.length} test ticket row(s):`);
for (const v of victims) console.log(`  #${v.ticket_number} guild=${v.guild_id} opener=${v.opener_id}`);

const info = db.prepare("DELETE FROM tickets WHERE guild_id NOT GLOB '[0-9]*'").run();
console.log(`\n✅ Removed ${info.changes} row(s).`);

const remaining = db.prepare("SELECT COUNT(*) AS c FROM tickets WHERE status='open'").get() as { c: number };
console.log(`Remaining OPEN tickets in DB: ${remaining.c}\n`);

closeDatabase();
/* eslint-enable no-console */
