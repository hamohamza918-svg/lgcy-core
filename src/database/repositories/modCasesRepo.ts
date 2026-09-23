import { getDb } from '../index.js';

export type ModActionType =
  | 'warn'
  | 'timeout'
  | 'untimeout'
  | 'kick'
  | 'ban'
  | 'unban';

export interface ModCase {
  id: number;
  guildId: string;
  caseNumber: number;
  type: ModActionType;
  targetId: string;
  targetTag: string | null;
  moderatorId: string;
  moderatorTag: string | null;
  reason: string | null;
  durationMs: number | null;
  active: boolean;
  createdAt: string;
}

interface NewModCase {
  guildId: string;
  type: ModActionType;
  targetId: string;
  targetTag?: string;
  moderatorId: string;
  moderatorTag?: string;
  reason?: string;
  durationMs?: number;
}

function rowToCase(r: Record<string, unknown>): ModCase {
  return {
    id: r.id as number,
    guildId: r.guild_id as string,
    caseNumber: r.case_number as number,
    type: r.type as ModActionType,
    targetId: r.target_id as string,
    targetTag: (r.target_tag as string) ?? null,
    moderatorId: r.moderator_id as string,
    moderatorTag: (r.moderator_tag as string) ?? null,
    reason: (r.reason as string) ?? null,
    durationMs: (r.duration_ms as number) ?? null,
    active: (r.active as number) === 1,
    createdAt: r.created_at as string,
  };
}

export const modCasesRepo = {
  /** Creates a case with a per-guild incrementing case number. */
  create(input: NewModCase): ModCase {
    const db = getDb();
    const next = db
      .prepare(
        'SELECT COALESCE(MAX(case_number), 0) + 1 AS n FROM mod_cases WHERE guild_id = ?',
      )
      .get(input.guildId) as { n: number };

    const info = db
      .prepare(
        `INSERT INTO mod_cases
          (guild_id, case_number, type, target_id, target_tag, moderator_id, moderator_tag, reason, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.guildId,
        next.n,
        input.type,
        input.targetId,
        input.targetTag ?? null,
        input.moderatorId,
        input.moderatorTag ?? null,
        input.reason ?? null,
        input.durationMs ?? null,
      );

    return this.getById(Number(info.lastInsertRowid))!;
  },

  getById(id: number): ModCase | null {
    const r = getDb()
      .prepare('SELECT * FROM mod_cases WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return r ? rowToCase(r) : null;
  },

  /** All cases for a member in a guild, newest first. */
  listForTarget(guildId: string, targetId: string): ModCase[] {
    const rows = getDb()
      .prepare(
        'SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? ORDER BY case_number DESC',
      )
      .all(guildId, targetId) as Record<string, unknown>[];
    return rows.map(rowToCase);
  },

  countWarnings(guildId: string, targetId: string): number {
    const r = getDb()
      .prepare(
        "SELECT COUNT(*) AS c FROM mod_cases WHERE guild_id = ? AND target_id = ? AND type = 'warn' AND active = 1",
      )
      .get(guildId, targetId) as { c: number };
    return r.c;
  },
};
