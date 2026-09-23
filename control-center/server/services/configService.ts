import {
  guildConfigSchema,
  getGuildConfig,
  setGuildConfig,
  type GuildConfig,
} from '../../../src/config/guildConfig.js';
import { appSettingsRepo } from '../../../src/database/repositories/appSettingsRepo.js';
import { credentials } from '../../../src/config/credentials.js';
import { getDb } from '../../../src/database/index.js';

export interface ConfigRevision {
  id: number;
  ts: string;
  label: string | null;
}

/** The guild the dashboard is editing. Falls back to a local preview id before
 * a real Guild ID is configured, so everything works pre-connection. */
export function activeGuildId(): string {
  return credentials.getGuildId() ?? 'preview-guild';
}

function draftKey(): string {
  return `draft:${activeGuildId()}`;
}

/** Deep-merge plain objects; arrays and primitives are replaced wholesale. */
function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(patch) || typeof patch !== 'object') return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k];
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v)
      ? deepMerge(cur, v)
      : v;
  }
  return out as T;
}

export const configService = {
  getApplied(): GuildConfig {
    return getGuildConfig(activeGuildId());
  },

  getDraft(): GuildConfig {
    const stored = appSettingsRepo.getJSON<GuildConfig>(draftKey());
    if (stored) {
      const parsed = guildConfigSchema.safeParse(stored);
      if (parsed.success) return parsed.data;
    }
    // Start a fresh draft from the applied config.
    return structuredClone(this.getApplied());
  },

  hasDraft(): boolean {
    return appSettingsRepo.get(draftKey()) !== null;
  },

  /** Merge a partial patch into the draft, validate, persist. Throws on invalid. */
  saveDraft(patch: unknown): GuildConfig {
    const merged = deepMerge(this.getDraft(), patch);
    const parsed = guildConfigSchema.safeParse(merged);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Invalid configuration: ${msg}`);
    }
    appSettingsRepo.setJSON(draftKey(), parsed.data);
    return parsed.data;
  },

  validateDraft(): { ok: boolean; errors: string[] } {
    const parsed = guildConfigSchema.safeParse(this.getDraft());
    if (parsed.success) return { ok: true, errors: [] };
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  },

  /** Human-readable diff between applied config and the current draft. */
  diff(): { path: string; from: unknown; to: unknown }[] {
    const applied = this.getApplied() as Record<string, unknown>;
    const draft = this.getDraft() as Record<string, unknown>;
    const changes: { path: string; from: unknown; to: unknown }[] = [];
    const keys = new Set([...Object.keys(applied), ...Object.keys(draft)]);
    for (const k of keys) {
      const a = JSON.stringify(applied[k]);
      const b = JSON.stringify(draft[k]);
      if (a !== b) changes.push({ path: k, from: applied[k], to: draft[k] });
    }
    return changes;
  },

  /** Applies the draft to the live (local DB) config and clears the draft.
   * Snapshots the PREVIOUS applied config to history first, so it can be
   * restored locally. Never pushes anything to Discord. */
  apply(label = 'before apply'): GuildConfig {
    const parsed = guildConfigSchema.parse(this.getDraft());
    this.snapshot(label); // preserve the current applied config for restore
    const saved = setGuildConfig(activeGuildId(), parsed);
    appSettingsRepo.delete(draftKey());
    return saved;
  },

  discardDraft(): void {
    appSettingsRepo.delete(draftKey());
  },

  /** Replaces the whole draft (used by restore). */
  setDraftFull(config: unknown): GuildConfig {
    const parsed = guildConfigSchema.parse(config);
    appSettingsRepo.setJSON(draftKey(), parsed);
    return parsed;
  },

  // ── config history (local revisions) ─────────────────────────────
  snapshot(label: string): void {
    const gid = activeGuildId();
    const db = getDb();
    db.prepare('INSERT INTO cc_config_history (guild_id, label, data) VALUES (?, ?, ?)')
      .run(gid, label, JSON.stringify(this.getApplied()));
    // keep only the most recent 20 revisions per guild
    db.prepare(
      `DELETE FROM cc_config_history WHERE guild_id = ? AND id NOT IN
         (SELECT id FROM cc_config_history WHERE guild_id = ? ORDER BY id DESC LIMIT 20)`,
    ).run(gid, gid);
  },

  history(): ConfigRevision[] {
    const rows = getDb()
      .prepare('SELECT id, ts, label FROM cc_config_history WHERE guild_id = ? ORDER BY id DESC LIMIT 20')
      .all(activeGuildId()) as Record<string, unknown>[];
    return rows.map((r) => ({ id: r.id as number, ts: r.ts as string, label: (r.label as string) ?? null }));
  },

  /** Stages a historical revision as the draft and returns the diff for preview.
   * Does NOT apply — the normal validate → diff → confirm flow still applies. */
  restoreToDraft(id: number): { draft: GuildConfig; changes: { path: string; from: unknown; to: unknown }[] } {
    const row = getDb()
      .prepare('SELECT data FROM cc_config_history WHERE id = ? AND guild_id = ?')
      .get(id, activeGuildId()) as { data: string } | undefined;
    if (!row) throw new Error('Revision not found.');
    const draft = this.setDraftFull(JSON.parse(row.data));
    return { draft, changes: this.diff() };
  },
};
