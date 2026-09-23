import { EmbedBuilder, type Guild, type AuditLogEvent } from 'discord.js';
import { getGuildConfig } from '../../config/guildConfig.js';

/** Consistent accent palette for all logs (LGCY colours). */
export const LOG_COLORS = {
  create: 0x35d07f, // green — created / added / joined
  delete: 0xff4d5e, // red — deleted / removed / left / banned
  update: 0x2b8cff, // blue — edited / updated
  mod: 0xff7a1a, // orange — moderator actions (ban/kick/timeout)
  neutral: 0x5865f2, // blurple
} as const;

/** Discord timestamp tokens. */
export const tExact = (sec: number) => `<t:${sec}:t>`;
export const tBoth = (sec: number) => `<t:${sec}:t> (<t:${sec}:R>)`;
export const tDate = (sec: number) => `<t:${sec}:f> (<t:${sec}:R>)`;
export const secOf = (d: Date | number) => Math.floor((typeof d === 'number' ? d : d.getTime()) / 1000);

export function trim(text: string | null | undefined, max = 1024): string {
  if (!text) return '*empty*';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** Whether footer IDs are enabled for this guild's logs (default on). */
export function idsOn(guildId: string): boolean {
  return getGuildConfig(guildId).logging.includeIds;
}

/** Adds an ID footer (only when enabled). Pairs are [label, id]. */
export function withIds(embed: EmbedBuilder, guildId: string, pairs: [string, string | undefined][]): EmbedBuilder {
  if (!idsOn(guildId)) return embed;
  const text = pairs.filter(([, v]) => v).map(([l, v]) => `${l} ${v}`).join(' • ');
  if (text) embed.setFooter({ text });
  return embed;
}

// ── Moderator attribution (reliable-or-null; never guesses) ─────────
export interface AuditLike {
  executorId: string | null;
  executorTag?: string | null;
  targetId?: string | null;
  createdTimestamp: number;
  reason?: string | null;
  changeKeys?: string[];
}
export interface Actor { id: string; tag: string; reason?: string }

/**
 * Picks the acting moderator ONLY when exactly one audit entry matches in-window
 * (and target/change-key when required). Zero or multiple → null (unknown). We
 * never guess who acted.
 */
export function pickActor(
  entries: AuditLike[],
  opts: { now: number; windowMs?: number; targetId?: string; requireChangeKey?: string },
): Actor | null {
  const win = opts.windowMs ?? 8000;
  const c = entries.filter(
    (e) =>
      e.executorId &&
      Math.abs(opts.now - e.createdTimestamp) <= win &&
      (!opts.targetId || e.targetId === opts.targetId) &&
      (!opts.requireChangeKey || (e.changeKeys ?? []).includes(opts.requireChangeKey)),
  );
  if (c.length !== 1) return null;
  const e = c[0]!;
  const a: Actor = { id: e.executorId!, tag: e.executorTag ?? e.executorId! };
  if (e.reason) a.reason = e.reason;
  return a;
}

/** Fetches the acting moderator from the guild audit log (needs View Audit Log). */
export async function fetchActor(
  guild: Guild,
  type: AuditLogEvent,
  opts: { targetId?: string; requireChangeKey?: string; windowMs?: number; now?: number } = {},
): Promise<Actor | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 8 });
    const entries: AuditLike[] = [...logs.entries.values()].map((e) => ({
      executorId: e.executor?.id ?? null,
      executorTag: e.executor?.tag ?? null,
      targetId: e.targetId ?? null,
      createdTimestamp: e.createdTimestamp,
      reason: e.reason ?? null,
      changeKeys: e.changes?.map((c) => c.key) ?? [],
    }));
    return pickActor(entries, {
      now: opts.now ?? Date.now(),
      windowMs: opts.windowMs,
      targetId: opts.targetId,
      requireChangeKey: opts.requireChangeKey,
    });
  } catch {
    return null; // no View Audit Log permission, or fetch failed
  }
}

/** "by <mod> · reason", or "by an unknown moderator" — for member mod actions. */
export function actorSuffix(actor: Actor | null): string {
  if (!actor) return 'by an unknown moderator';
  return `by **${actor.tag}**${actor.reason ? ` · ${actor.reason}` : ''}`;
}

/** "by <user> · reason", or "by unknown" — for structural (channel/role) events. */
export function byLine(actor: Actor | null): string {
  if (!actor) return 'by unknown';
  return `by **${actor.tag}**${actor.reason ? ` · ${actor.reason}` : ''}`;
}
