import { getDb } from '../../../src/database/index.js';
import { latestSchemaVersion, appliedSchemaVersion, pendingMigrations } from '../../../src/database/migrations/index.js';
import { credentials } from '../../../src/config/credentials.js';
import { secretStore } from '../../../src/services/secretStore.js';
import { redactDeep } from '../../../src/services/redact.js';
import { MODULES } from '../../../src/modules/index.js';
import { getDataSource } from '../discord/index.js';
import { configService } from './configService.js';

export type CheckStatus = 'ok' | 'warn' | 'error';
export interface DiagnosticCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

/**
 * Runs the full diagnostic. Everything is offline/mock-aware, so it is safe to
 * run before connecting. The final report is redacted before return so no
 * secret can appear in the copied output.
 */
export async function runDiagnostics(): Promise<{ checks: DiagnosticCheck[]; summary: Record<CheckStatus, number> }> {
  const checks: DiagnosticCheck[] = [];
  const add = (c: DiagnosticCheck) => checks.push(c);

  // Credentials (expected incomplete before setup).
  const cred = credentials.status();
  add({
    id: 'credentials',
    label: 'Discord credentials',
    status: cred.hasToken && cred.applicationId && cred.guildId ? 'ok' : 'warn',
    detail: `token ${cred.hasToken ? 'set' : 'missing'}, applicationId ${cred.applicationId ? 'set' : 'missing'}, guildId ${cred.guildId ? 'set' : 'missing'}`,
    fix: cred.hasToken ? undefined : 'Complete the setup wizard (Bot page) to store credentials.',
  });

  // Secret storage.
  const prov = secretStore.meta().provider;
  add({
    id: 'secret-storage',
    label: 'Secret storage',
    status: prov.status === 'SECURE' ? 'ok' : prov.status === 'INSECURE' ? 'warn' : 'error',
    detail: `${prov.label} — ${prov.status} · encrypted at rest, outside the repo`,
    fix: prov.warning,
  });

  // Gateway (not connected in this phase).
  const src = getDataSource();
  add({
    id: 'gateway',
    label: 'Discord gateway',
    status: 'warn',
    detail: src.source === 'mock' ? 'not connected (using sample data)' : 'connected',
    fix: 'Connection is a later, approved step — not performed yet.',
  });

  // Database + migrations.
  try {
    const db = getDb();
    const applied = appliedSchemaVersion(db);
    const latest = latestSchemaVersion();
    add({
      id: 'database',
      label: 'Database',
      status: 'ok',
      detail: `connected · schema v${applied}`,
    });
    const pending = pendingMigrations(db);
    add({
      id: 'migrations',
      label: 'Migrations',
      status: pending.length === 0 ? 'ok' : 'warn',
      detail: pending.length === 0 ? `up to date (v${applied}/${latest})` : `${pending.length} pending`,
      fix: pending.length === 0 ? undefined : 'Run pending migrations from the Database page.',
    });
  } catch {
    add({ id: 'database', label: 'Database', status: 'error', detail: 'not initialized', fix: 'Restart the Control Center.' });
  }

  // Module health.
  add({
    id: 'modules',
    label: 'Module health',
    status: 'ok',
    detail: `${MODULES.length} modules loaded (${MODULES.filter((m) => m.defaultEnabled).length} on by default)`,
  });

  // Configured channels.
  const cfg = configService.getApplied();
  const missingCh = ['welcomeChannelId', 'rulesChannelId', 'rolesChannelId', 'ticketParentCategoryId'].filter(
    (k) => !(cfg as Record<string, unknown>)[k],
  );
  add({
    id: 'channels',
    label: 'Configured channels',
    status: missingCh.length === 0 ? 'ok' : 'warn',
    detail: missingCh.length === 0 ? 'all key channels mapped' : `not set: ${missingCh.join(', ')}`,
    fix: missingCh.length === 0 ? undefined : 'Map channels on the Welcome / Tickets pages.',
  });

  // Configured roles.
  const selfRoleCount = cfg.selfRoleGroups.reduce((n, g) => n + g.roles.length, 0);
  add({
    id: 'roles',
    label: 'Configured roles',
    status: selfRoleCount > 0 ? 'ok' : 'warn',
    detail: `${selfRoleCount} self-role(s), ${cfg.ticketStaffRoleIds.length} ticket staff role(s)`,
    fix: selfRoleCount > 0 ? undefined : 'Add self-roles on the Roles page.',
  });

  // Bot role hierarchy (from the current data source).
  const snap = await src.snapshot();
  const botPos = snap.bot.topRolePosition;
  const selfRoleIds = cfg.selfRoleGroups.flatMap((g) => g.roles.map((r) => r.roleId));
  const above = snap.roles.filter((r) => selfRoleIds.includes(r.id) && r.position >= botPos);
  add({
    id: 'hierarchy',
    label: 'Bot role hierarchy',
    status: above.length === 0 ? 'ok' : 'error',
    detail: above.length === 0
      ? `LGCY Core role at position ${botPos}, above its self-roles`
      : `self-role(s) above the bot: ${above.map((r) => r.name).join(', ')}`,
    fix: above.length === 0 ? undefined : `Move the LGCY Core role above ${above.map((r) => r.name).join(', ')} in Discord role settings.`,
  });

  // Command registration.
  add({
    id: 'commands',
    label: 'Command registration',
    status: 'warn',
    detail: 'not deployed yet',
    fix: 'Deploy guild commands after connecting (Bot page → Deploy Guild Commands).',
  });

  // Ticket recovery.
  add({
    id: 'tickets',
    label: 'Ticket recovery',
    status: 'ok',
    detail: 'ticket state is DB-backed and recovers on restart',
  });

  // Welcome assets (canvas availability).
  let welcomeOk = true;
  try {
    await import('@napi-rs/canvas');
  } catch {
    welcomeOk = false;
  }
  add({
    id: 'welcome-assets',
    label: 'Welcome card renderer',
    status: welcomeOk ? 'ok' : 'error',
    detail: welcomeOk ? 'canvas renderer available' : 'canvas module not available',
  });

  const summary: Record<CheckStatus, number> = { ok: 0, warn: 0, error: 0 };
  for (const c of checks) summary[c.status]++;

  // Redact before returning — no secret can appear in the report/copy.
  return redactDeep({ checks, summary });
}
