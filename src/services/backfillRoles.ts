import { type Guild } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { getGuildConfig } from '../config/guildConfig.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('autorole-backfill');

/**
 * One-time: when BACKFILL_AUTOROLE=1, give every existing HUMAN member any
 * configured autoRoleIds they don't already have (additive only — never removes
 * roles; skips bots and roles the bot can't manage). Remove the flag after.
 */
export async function maybeBackfillAutoRoles(guild: Guild): Promise<void> {
  if (loadEnv().BACKFILL_AUTOROLE !== '1') return;
  const cfg = getGuildConfig(guild.id);
  if (!cfg.autoRoleIds.length) { log.warn('BACKFILL_AUTOROLE set but no autoRoleIds configured'); return; }

  const botTop = guild.members.me?.roles.highest.position ?? 0;
  const roleIds = cfg.autoRoleIds.filter((id) => {
    const r = guild.roles.cache.get(id);
    return r && !r.managed && r.position < botTop;
  });
  if (!roleIds.length) { log.warn({ autoRoleIds: cfg.autoRoleIds }, 'no assignable auto-roles (missing or above bot)'); return; }

  await guild.members.fetch();
  let added = 0, alreadyHad = 0, bots = 0, failed = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user.bot) { bots++; continue; }
    const missing = roleIds.filter((id) => !member.roles.cache.has(id));
    if (!missing.length) { alreadyHad++; continue; }
    try { await member.roles.add(missing, 'Backfill auto-role'); added++; }
    catch (err) { failed++; log.warn({ user: member.id, err: (err as Error).message }, 'backfill add failed'); }
  }
  log.info({ added, alreadyHad, bots, failed }, 'auto-role backfill complete — remove BACKFILL_AUTOROLE env now');
}
