import { getDataSource } from '../discord/index.js';

const GAME_ROLES = ['FiveM', 'Minecraft', 'ARK', 'FIFA', 'Overwatch'];
const STAFF_HINTS = /owner|co[-\s]?owner|admin|moderator|\bmod\b|manager|staff|support|developer|\bdev\b|security/i;

function pick(items: { id: string; name: string }[], test: (n: string) => boolean): string | null {
  return items.find((i) => test(i.name.toLowerCase()))?.id ?? null;
}

/**
 * Builds a PROPOSED channel/role mapping by name-matching against EXISTING
 * objects in the active data source (mock or live). It only proposes — it never
 * writes to the guild config and never touches Discord. The user reviews and
 * approves before anything is applied.
 */
export async function buildProposedMapping() {
  const snap = await getDataSource().snapshot();
  const text = snap.channels.filter((c) => c.type === 'text' || c.type === 'announcement');
  const cats = snap.channels.filter((c) => c.type === 'category');
  const roles = snap.roles;

  const named = (id: string | null, pool: { id: string; name: string }[]) =>
    id ? { id, name: pool.find((p) => p.id === id)?.name ?? id } : null;

  return {
    source: snap.source,
    guild: { id: snap.guild.id, name: snap.guild.name },
    start: {
      welcome: named(pick(text, (n) => n.includes('welcome') || n.includes('join')), text),
      rules: named(pick(text, (n) => n.includes('rule')), text),
      roles: named(pick(text, (n) => n.includes('role')), text),
    },
    tickets: {
      panel: named(pick(text, (n) => n.includes('ticket') || n.includes('support') || n.includes('help')), text),
      parentCategory: named(pick(cats, (n) => n.includes('ticket') || n.includes('support')), cats),
      archiveCategory: named(pick(cats, (n) => n.includes('archive') || n.includes('closed')), cats),
      log: named(pick(text, (n) => n.includes('ticket-log')), text),
    },
    logs: {
      member: named(pick(text, (n) => n.includes('member') || n.includes('join')), text),
      message: named(pick(text, (n) => n.includes('message-log') || n.includes('msg-log')), text),
      role: named(pick(text, (n) => n.includes('role-log')), text),
      moderation: named(pick(text, (n) => n.includes('mod-log') || n.includes('modlog') || n.includes('moderation')), text),
      voice: named(pick(text, (n) => n.includes('voice-log')), text),
      server: named(pick(text, (n) => n.includes('server-log') || n.includes('audit')), text),
    },
    selfRoles: Object.fromEntries(
      GAME_ROLES.map((g) => [g, named(pick(roles, (n) => n.includes(g.toLowerCase())), roles)]),
    ),
    suggestedStaffRoles: roles.filter((r) => STAFF_HINTS.test(r.name)).map((r) => ({ id: r.id, name: r.name })),
    note: 'Proposal only — nothing has been written to the guild config or to Discord. Review, then apply via the config pages.',
  };
}
