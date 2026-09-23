import { getDb } from '../index.js';

/** Non-secret key/value app settings. NEVER used for the bot token. */
export const appSettingsRepo = {
  get(key: string): string | null {
    const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  },

  set(key: string, value: string): void {
    getDb()
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      )
      .run(key, value);
  },

  delete(key: string): void {
    getDb().prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  },

  getJSON<T>(key: string): T | null {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  setJSON(key: string, value: unknown): void {
    this.set(key, JSON.stringify(value));
  },
};
