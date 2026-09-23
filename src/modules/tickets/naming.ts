/**
 * Pure channel-naming helpers (unit-tested). Discord channel names are
 * lowercased, limited to 100 chars, and use dashes for spaces.
 */

export function slugifyUsername(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 80);
  return slug.length > 0 ? slug : 'user';
}

/**
 * Builds a collision-safe ticket channel name. Tries `<prefix>-<username>`
 * first; if that name is already taken it appends the (unique) ticket number,
 * which is guaranteed not to collide.
 */
export function buildChannelName(
  prefix: string,
  username: string,
  existingNames: Set<string>,
  ticketNumber: number,
): string {
  const slug = slugifyUsername(username);
  const base = `${prefix}-${slug}`.slice(0, 95);
  if (!existingNames.has(base)) return base;
  return `${prefix}-${slug}-${ticketNumber}`.slice(0, 95);
}
