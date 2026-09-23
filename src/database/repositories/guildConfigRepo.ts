import { getDb } from '../index.js';

/** Raw storage for the per-guild JSON config blob. Shape validation lives in
 * config/guildConfig.ts — this layer only persists strings. */
export const guildConfigRepo = {
  getRaw(guildId: string): string | null {
    const row = getDb()
      .prepare('SELECT data FROM guild_config WHERE guild_id = ?')
      .get(guildId) as { data: string } | undefined;
    return row?.data ?? null;
  },

  setRaw(guildId: string, data: string): void {
    getDb()
      .prepare(
        `INSERT INTO guild_config (guild_id, data, updated_at)
         VALUES (?, ?, datetime('now'))
         ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
      )
      .run(guildId, data);
  },
};
