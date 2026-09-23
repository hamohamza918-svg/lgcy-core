import type { Migration } from './index.js';

/**
 * Control Center bookkeeping: an audit trail of dashboard actions and a history
 * of applied configuration snapshots (for local restore). Neither table ever
 * stores secrets.
 */
export const migration004: Migration = {
  version: 4,
  name: 'control_center',
  up(db) {
    db.exec(`
      CREATE TABLE cc_audit (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        ts      TEXT NOT NULL DEFAULT (datetime('now')),
        action  TEXT NOT NULL,
        module  TEXT,
        result  TEXT NOT NULL,          -- ok | error | info
        detail  TEXT
      );
    `);
    db.exec(`CREATE INDEX idx_cc_audit_ts ON cc_audit (ts DESC);`);

    db.exec(`
      CREATE TABLE cc_config_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id  TEXT NOT NULL,
        ts        TEXT NOT NULL DEFAULT (datetime('now')),
        label     TEXT,
        data      TEXT NOT NULL           -- JSON snapshot of the config BEFORE an apply
      );
    `);
    db.exec(`CREATE INDEX idx_cc_history_guild ON cc_config_history (guild_id, ts DESC);`);
  },
};
