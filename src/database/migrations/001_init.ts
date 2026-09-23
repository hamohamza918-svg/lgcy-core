import type { Migration } from './index.js';

/**
 * Initial schema. Covers everything Phase 1 needs plus the tables future
 * modules will grow into (tickets, temp voice). New columns/tables arrive as
 * additional migration files, not edits to this one.
 */
export const migration001: Migration = {
  version: 1,
  name: 'init',
  up(db) {
    // Per-guild configuration. Stored as a single JSON blob so new config keys
    // don't require a schema migration — the config layer validates shape.
    db.exec(`
      CREATE TABLE guild_config (
        guild_id   TEXT PRIMARY KEY,
        data       TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // Moderation cases: warns, timeouts, kicks, bans, etc.
    db.exec(`
      CREATE TABLE mod_cases (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id    TEXT NOT NULL,
        case_number INTEGER NOT NULL,
        type        TEXT NOT NULL,          -- warn | timeout | untimeout | kick | ban | unban
        target_id   TEXT NOT NULL,
        target_tag  TEXT,
        moderator_id TEXT NOT NULL,
        moderator_tag TEXT,
        reason      TEXT,
        duration_ms INTEGER,                -- for timeouts / temp actions
        active      INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.exec(
      `CREATE INDEX idx_mod_cases_guild_target ON mod_cases (guild_id, target_id);`,
    );
    db.exec(
      `CREATE UNIQUE INDEX idx_mod_cases_case_number ON mod_cases (guild_id, case_number);`,
    );

    // Tickets (foundation — module ships in a later Phase-1 step).
    db.exec(`
      CREATE TABLE tickets (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id     TEXT NOT NULL,
        ticket_number INTEGER NOT NULL,
        channel_id   TEXT,
        opener_id    TEXT NOT NULL,
        claimed_by   TEXT,
        category     TEXT,
        reason       TEXT,
        status       TEXT NOT NULL DEFAULT 'open', -- open | claimed | closed
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at    TEXT
      );
    `);
    db.exec(
      `CREATE INDEX idx_tickets_guild_status ON tickets (guild_id, status);`,
    );

    // Temporary / private voice state (module ships disabled — see voice module).
    db.exec(`
      CREATE TABLE temp_voice (
        channel_id  TEXT PRIMARY KEY,
        guild_id    TEXT NOT NULL,
        owner_id    TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
