import { getDb } from '../../../src/database/index.js';
import { redactString } from '../../../src/services/redact.js';

export type AuditResult = 'ok' | 'error' | 'info';
export interface AuditEntry {
  id: number;
  ts: string;
  action: string;
  module: string | null;
  result: AuditResult;
  detail: string | null;
}

/**
 * Control Center audit trail — records dashboard actions (never secrets). This
 * is distinct from Discord moderation logs. Details are redacted defensively.
 */
export const auditService = {
  record(action: string, opts: { module?: string; result?: AuditResult; detail?: string } = {}): void {
    try {
      getDb()
        .prepare('INSERT INTO cc_audit (action, module, result, detail) VALUES (?, ?, ?, ?)')
        .run(
          redactString(action),
          opts.module ?? null,
          opts.result ?? 'ok',
          opts.detail ? redactString(opts.detail) : null,
        );
    } catch {
      /* auditing must never break the action it records */
    }
  },

  list(limit = 50): AuditEntry[] {
    const rows = getDb()
      .prepare('SELECT * FROM cc_audit ORDER BY id DESC LIMIT ?')
      .all(Math.min(limit, 200)) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      action: r.action as string,
      module: (r.module as string) ?? null,
      result: r.result as AuditResult,
      detail: (r.detail as string) ?? null,
    }));
  },
};
