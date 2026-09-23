import type { Migration } from './index.js';

/**
 * Non-secret, app-level key/value settings managed by the Control Center:
 * application id, guild id, saved config drafts, dashboard state, etc.
 * The bot TOKEN is NEVER stored here — it lives only in the encrypted secret
 * store (src/services/secretStore.ts).
 */
export const migration003: Migration = {
  version: 3,
  name: 'app_settings',
  up(db) {
    db.exec(`
      CREATE TABLE app_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
