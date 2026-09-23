import { getDb } from '../index.js';

export type TicketStatus = 'open' | 'closed';

export interface Ticket {
  id: number;
  guildId: string;
  ticketNumber: number;
  channelId: string | null;
  openerId: string;
  category: string;
  subject: string | null;
  description: string | null;
  status: TicketStatus;
  claimedBy: string | null;
  createdAt: string;
  closedAt: string | null;
  closedBy: string | null;
  closeReason: string | null;
}

interface NewTicket {
  guildId: string;
  openerId: string;
  category: string;
  subject: string;
  description: string;
}

function rowToTicket(r: Record<string, unknown>): Ticket {
  return {
    id: r.id as number,
    guildId: r.guild_id as string,
    ticketNumber: r.ticket_number as number,
    channelId: (r.channel_id as string) ?? null,
    openerId: r.opener_id as string,
    category: r.category as string,
    subject: (r.subject as string) ?? null,
    description: (r.description as string) ?? null,
    status: r.status as TicketStatus,
    claimedBy: (r.claimed_by as string) ?? null,
    createdAt: r.created_at as string,
    closedAt: (r.closed_at as string) ?? null,
    closedBy: (r.closed_by as string) ?? null,
    closeReason: (r.close_reason as string) ?? null,
  };
}

export const ticketsRepo = {
  /**
   * Creates a ticket row with a per-guild incrementing, persistent ticket
   * number. channel_id is filled in after the channel is created (setChannel).
   */
  create(input: NewTicket): Ticket {
    const db = getDb();
    const next = db
      .prepare(
        'SELECT COALESCE(MAX(ticket_number), 0) + 1 AS n FROM tickets WHERE guild_id = ?',
      )
      .get(input.guildId) as { n: number };

    const info = db
      .prepare(
        `INSERT INTO tickets
           (guild_id, ticket_number, channel_id, opener_id, category, subject, description, status)
         VALUES (?, ?, NULL, ?, ?, ?, ?, 'open')`,
      )
      .run(
        input.guildId,
        next.n,
        input.openerId,
        input.category,
        input.subject,
        input.description,
      );
    return this.getById(Number(info.lastInsertRowid))!;
  },

  setChannel(id: number, channelId: string): void {
    getDb().prepare('UPDATE tickets SET channel_id = ? WHERE id = ?').run(channelId, id);
  },

  getById(id: number): Ticket | null {
    const r = getDb().prepare('SELECT * FROM tickets WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return r ? rowToTicket(r) : null;
  },

  getByChannel(channelId: string): Ticket | null {
    const r = getDb()
      .prepare('SELECT * FROM tickets WHERE channel_id = ?')
      .get(channelId) as Record<string, unknown> | undefined;
    return r ? rowToTicket(r) : null;
  },

  /** An open ticket by the same opener in the same category, if any. */
  findOpenByOpenerCategory(
    guildId: string,
    openerId: string,
    category: string,
  ): Ticket | null {
    const r = getDb()
      .prepare(
        "SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND category = ? AND status = 'open' LIMIT 1",
      )
      .get(guildId, openerId, category) as Record<string, unknown> | undefined;
    return r ? rowToTicket(r) : null;
  },

  /** Number of tickets the opener created at/after the given ISO timestamp. */
  countCreatedSince(guildId: string, openerId: string, sinceIso: string): number {
    const r = getDb()
      .prepare(
        'SELECT COUNT(*) AS c FROM tickets WHERE guild_id = ? AND opener_id = ? AND created_at >= ?',
      )
      .get(guildId, openerId, sinceIso) as { c: number };
    return r.c;
  },

  listOpen(guildId: string): Ticket[] {
    const rows = getDb()
      .prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = 'open' ORDER BY ticket_number")
      .all(guildId) as Record<string, unknown>[];
    return rows.map(rowToTicket);
  },

  listAllOpen(): Ticket[] {
    const rows = getDb()
      .prepare("SELECT * FROM tickets WHERE status = 'open'")
      .all() as Record<string, unknown>[];
    return rows.map(rowToTicket);
  },

  /**
   * Atomically claims a ticket only if it is open and unclaimed. Returns true
   * if this call is the one that claimed it — this is what prevents accidental
   * double-claims when two staff click at once.
   */
  claim(id: number, staffId: string): boolean {
    const info = getDb()
      .prepare(
        "UPDATE tickets SET claimed_by = ? WHERE id = ? AND status = 'open' AND claimed_by IS NULL",
      )
      .run(staffId, id);
    return info.changes > 0;
  },

  /** Reassigns an open ticket (authorized transfer). */
  transfer(id: number, staffId: string): boolean {
    const info = getDb()
      .prepare("UPDATE tickets SET claimed_by = ? WHERE id = ? AND status = 'open'")
      .run(staffId, id);
    return info.changes > 0;
  },

  /** Closes an open ticket. Returns false if it was already closed. */
  close(id: number, closedBy: string, reason: string | null): boolean {
    const info = getDb()
      .prepare(
        "UPDATE tickets SET status = 'closed', closed_by = ?, close_reason = ?, closed_at = datetime('now') WHERE id = ? AND status = 'open'",
      )
      .run(closedBy, reason, id);
    return info.changes > 0;
  },

  reopen(id: number): boolean {
    const info = getDb()
      .prepare(
        "UPDATE tickets SET status = 'open', closed_by = NULL, close_reason = NULL, closed_at = NULL WHERE id = ? AND status = 'closed'",
      )
      .run(id);
    return info.changes > 0;
  },

  delete(id: number): void {
    getDb().prepare('DELETE FROM tickets WHERE id = ?').run(id);
  },
};
