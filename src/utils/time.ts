/**
 * Parse a human duration like "10m", "2h", "1d", "30s", "1w" into milliseconds.
 * Returns null when the input can't be parsed. Used by /timeout and /slowmode.
 */
const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

export function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  const match = /^(\d+)\s*(s|m|h|d|w|sec|min|hour|day|week)s?$/.exec(trimmed);
  if (!match) return null;
  const value = Number(match[1]);
  const unitRaw = match[2]!;
  const unit = unitRaw[0]!; // s/m/h/d/w
  const ms = value * (UNIT_MS[unit] ?? 0);
  return ms > 0 ? ms : null;
}

/** Format a Date as SQLite's `datetime('now')` shape (UTC "YYYY-MM-DD HH:MM:SS")
 * so string comparisons against stored timestamps are valid. */
export function toSqliteTime(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

/** Parse a SQLite UTC timestamp string back into a Date. */
export function sqliteToDate(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z');
}

/** Format milliseconds back into a compact human string, e.g. "1h 30m". */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const units: [string, number][] = [
    ['w', 604_800_000],
    ['d', 86_400_000],
    ['h', 3_600_000],
    ['m', 60_000],
    ['s', 1000],
  ];
  const parts: string[] = [];
  let remaining = ms;
  for (const [label, size] of units) {
    if (remaining >= size) {
      const n = Math.floor(remaining / size);
      remaining -= n * size;
      parts.push(`${n}${label}`);
    }
  }
  return parts.slice(0, 2).join(' ');
}
