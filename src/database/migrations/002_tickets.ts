import type { Migration } from './index.js';

/**
 * Extends the tickets table (created in 001) with the full metadata the ticket
 * system persists: subject, description, and close attribution. Forward-only —
 * added as a new migration rather than editing 001.
 */
export const migration002: Migration = {
  version: 2,
  name: 'tickets_metadata',
  up(db) {
    db.exec(`ALTER TABLE tickets ADD COLUMN subject TEXT;`);
    db.exec(`ALTER TABLE tickets ADD COLUMN description TEXT;`);
    db.exec(`ALTER TABLE tickets ADD COLUMN closed_by TEXT;`);
    db.exec(`ALTER TABLE tickets ADD COLUMN close_reason TEXT;`);
    // Guarantees ticket numbers are unique per guild (they persist across restarts).
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_number ON tickets (guild_id, ticket_number);`,
    );
    // Fast lookup by channel for in-ticket component actions.
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets (channel_id);`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_tickets_opener ON tickets (guild_id, opener_id);`,
    );
  },
};
