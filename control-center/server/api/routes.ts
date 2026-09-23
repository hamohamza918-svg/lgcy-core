import { Router } from 'express';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { asyncRoute, CSRF_TOKEN } from '../security.js';
import { APP_VERSION } from '../../../src/config/version.js';
import { credentials } from '../../../src/config/credentials.js';
import { secretStore } from '../../../src/services/secretStore.js';
import { MODULES } from '../../../src/modules/index.js';
import { getDataSource } from '../discord/index.js';
import { SAMPLE_OTHER_BOTS } from '../discord/mockSource.js';
import { requiredPermissionsBitfield, REQUIRED_PERMISSIONS } from '../../../src/config/requiredPermissions.js';
import { ticketsRepo } from '../../../src/database/repositories/ticketsRepo.js';
import { appSettingsRepo } from '../../../src/database/repositories/appSettingsRepo.js';
import { configService, activeGuildId } from '../services/configService.js';
import { moduleService } from '../services/moduleService.js';
import { roleService } from '../services/roleService.js';
import { roleManagerService } from '../services/roleManagerService.js';
import { applyEngineService } from '../services/applyEngineService.js';
import { runDiagnostics } from '../services/diagnosticsService.js';
import { databaseService } from '../services/databaseService.js';
import { exportService } from '../services/exportService.js';
import { renderWelcomePreview } from '../services/welcomePreview.js';
import { auditService } from '../services/auditService.js';
import { systemHealth } from '../services/healthService.js';
import { liveLock } from '../services/liveLock.js';
import { connectionService } from '../services/connectionService.js';
import { buildProposedMapping } from '../services/mappingService.js';

const INTENTS = [
  { name: 'Guilds', privileged: false },
  { name: 'GuildMembers', privileged: true },
  { name: 'GuildMessages', privileged: false },
  { name: 'MessageContent', privileged: true },
  { name: 'GuildVoiceStates', privileged: false },
  { name: 'GuildModeration', privileged: false },
];

export function apiRouter(): Router {
  const r = Router();

  // ── bootstrap / state ────────────────────────────────────────────────
  r.get('/state', asyncRoute(async (_req, res) => {
    const src = getDataSource();
    const conn = connectionService.status();
    res.json({
      app: 'LGCY Control Center',
      version: APP_VERSION,
      csrfToken: CSRF_TOKEN,
      setupComplete: credentials.isConfigured(),
      credentials: credentials.status(),
      source: src.source,
      mode: src.source === 'mock' ? 'MOCK' : 'LIVE',
      // Cheap: use the stored guild name — never force a live fetch on /state.
      guildName: conn.guildName ?? 'LGCY',
      secretProvider: secretStore.meta().provider,
      connection: conn.state,
      liveLock: liveLock.status(),
      hasDraft: configService.hasDraft(),
    });
  }));

  // ── connection workflow (read-only) ──────────────────────────────────
  r.get('/connection', asyncRoute(async (_req, res) => res.json({ ...connectionService.status(), liveLock: liveLock.status() })));
  r.post('/connection/test', asyncRoute(async (_req, res) => {
    const out = await connectionService.testCredentials();
    auditService.record('Credentials tested (read-only)', { module: 'connection', result: out.ok ? 'ok' : 'error' });
    res.json(out);
  }));
  r.post('/connection/connect', asyncRoute(async (_req, res) => {
    const out = await connectionService.connect();
    auditService.record('Connected read-only', { module: 'connection', result: 'ok', detail: out.guildName ?? undefined });
    res.json(out);
  }));
  r.post('/connection/disconnect', asyncRoute(async (_req, res) => {
    const out = await connectionService.disconnect();
    auditService.record('Disconnected', { module: 'connection', result: 'info' });
    res.json(out);
  }));
  r.get('/mapping', asyncRoute(async (_req, res) => res.json(await buildProposedMapping())));
  r.get('/lock', asyncRoute(async (_req, res) => res.json(liveLock.status())));

  // overall system health (for the header badge → Diagnostics)
  r.get('/health', asyncRoute(async (_req, res) => res.json(await systemHealth())));
  // secret provider status (no secrets)
  r.get('/provider', asyncRoute(async (_req, res) => res.json(secretStore.meta().provider)));
  // control-center audit trail
  r.get('/audit', asyncRoute(async (_req, res) => res.json({ entries: auditService.list(80) })));
  // local config revision history
  r.get('/config/history', asyncRoute(async (_req, res) => res.json({ revisions: configService.history() })));
  r.post('/config/history/:id/restore', asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    const out = configService.restoreToDraft(id);
    auditService.record('Config revision staged for restore', { module: 'config', detail: `revision #${id}` });
    res.json(out);
  }));

  // ── overview ─────────────────────────────────────────────────────────
  r.get('/overview', asyncRoute(async (_req, res) => {
    const snap = await getDataSource().snapshot();
    const db = databaseService.stats();
    res.json({
      bot: { username: snap.bot.username, id: snap.bot.id, avatarUrl: snap.bot.avatarUrl, online: false },
      guild: snap.guild,
      gateway: { connected: snap.connected, source: snap.source, pingMs: snap.gatewayPingMs },
      database: { healthy: db.healthy, schemaVersion: db.schemaVersion },
      commands: MODULES.flatMap((m) => m.commands ?? []).length,
      modules: moduleService.list().map((m) => ({ name: m.name, icon: m.icon, enabled: m.enabled })),
      activity: recentActivity(),
    });
  }));

  // ── bot page ─────────────────────────────────────────────────────────
  r.get('/bot', asyncRoute(async (_req, res) => {
    const snap = await getDataSource().snapshot();
    res.json({
      identity: { username: snap.bot.username, id: snap.bot.id },
      credentials: credentials.status(),
      gateway: { connected: snap.connected, source: snap.source, pingMs: snap.gatewayPingMs },
      intents: INTENTS,
      permissions: {
        integer: requiredPermissionsBitfield().bitfield.toString(),
        list: REQUIRED_PERMISSIONS.map((p) => ({ name: p.name, why: p.why })),
      },
      rolePosition: snap.bot.topRolePosition,
      commandsDeployed: false,
    });
  }));

  r.post('/bot/action', asyncRoute(async (req, res) => {
    const { action } = z.object({ action: z.enum(['start', 'stop', 'restart', 'doctor', 'deploy', 'refresh']) }).parse(req.body);
    // Actions that would mutate Discord or bring the full bot (with event
    // handlers) online are hard-blocked by the global lock — even via direct API.
    const MUTATING = new Set(['start', 'restart', 'deploy']);
    if (MUTATING.has(action)) {
      liveLock.assert(`Bot action "${action}"`); // throws 423 while locked
    }
    if (action === 'refresh') {
      // read-only: refresh live discovery caches (no writes)
      await getDataSource().snapshot();
      res.json({ ok: true, action, message: 'Discovery data refreshed (read-only).' });
      return;
    }
    res.json({ ok: false, action, message: 'This action needs a later, approved deployment phase — nothing was sent to Discord.' });
  }));

  // ── modules ──────────────────────────────────────────────────────────
  r.get('/modules', asyncRoute(async (_req, res) => res.json({ modules: moduleService.list() })));
  r.post('/modules/:name/toggle', asyncRoute(async (req, res) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const mod = moduleService.setEnabled(String(req.params.name), enabled);
    auditService.record(`Module ${enabled ? 'enabled' : 'disabled'}`, { module: mod.name, result: 'ok' });
    res.json({ module: mod });
  }));

  // ── discord read-only data (for dropdowns / inspector) ───────────────
  r.get('/discord/snapshot', asyncRoute(async (_req, res) => res.json(await getDataSource().snapshot())));
  r.get('/discord/channels', asyncRoute(async (_req, res) => {
    const snap = await getDataSource().snapshot();
    res.json({ channels: snap.channels });
  }));

  // ── config draft/apply ───────────────────────────────────────────────
  r.get('/config/applied', asyncRoute(async (_req, res) => res.json(configService.getApplied())));
  r.get('/config/draft', asyncRoute(async (_req, res) => res.json({ draft: configService.getDraft(), hasDraft: configService.hasDraft() })));
  r.post('/config/draft', asyncRoute(async (req, res) => {
    const patch = z.record(z.string(), z.unknown()).parse(req.body);
    const draft = configService.saveDraft(patch);
    auditService.record('Configuration draft saved', { module: 'config', detail: Object.keys(patch).join(', ') });
    res.json({ draft });
  }));
  r.get('/config/validate', asyncRoute(async (_req, res) => res.json(configService.validateDraft())));
  r.get('/config/diff', asyncRoute(async (_req, res) => res.json({ changes: configService.diff() })));
  r.post('/config/apply', asyncRoute(async (_req, res) => {
    const applied = configService.apply();
    auditService.record('Configuration applied to local config', { module: 'config', result: 'ok' });
    res.json({ applied });
  }));
  r.post('/config/discard', asyncRoute(async (_req, res) => {
    configService.discardDraft();
    auditService.record('Configuration draft discarded', { module: 'config', result: 'info' });
    res.json({ ok: true });
  }));

  // ── welcome background upload (local asset; not a Discord mutation) ───
  r.post('/welcome/background', asyncRoute(async (req, res) => {
    const { data } = z.object({ data: z.string().min(20) }).parse(req.body);
    const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(data);
    if (!m) throw new Error('Unsupported image — use PNG, JPG, or WebP.');
    const buf = Buffer.from(m[2]!, 'base64');
    if (buf.length > 8_000_000) throw new Error('Image too large (max ~8MB).');
    const dir = resolve(process.cwd(), 'assets');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, `welcome-bg-${activeGuildId()}.png`);
    writeFileSync(file, buf);
    configService.saveDraft({ welcomeBackground: file });
    auditService.record('Welcome background uploaded', { module: 'welcome', detail: `${(buf.length / 1024).toFixed(0)}KB` });
    res.json({ ok: true });
  }));
  r.post('/welcome/background/reset', asyncRoute(async (_req, res) => {
    configService.saveDraft({ welcomeBackground: '' });
    auditService.record('Welcome background reset', { module: 'welcome', result: 'info' });
    res.json({ ok: true });
  }));

  // ── welcome preview (PNG) ────────────────────────────────────────────
  r.get('/welcome/preview.png', asyncRoute(async (_req, res) => {
    const snap = await getDataSource().snapshot();
    const png = await renderWelcomePreview(configService.getDraft(), snap.guild.memberCount);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.end(png);
  }));

  // ── roles ────────────────────────────────────────────────────────────
  r.get('/roles', asyncRoute(async (_req, res) => {
    res.json({ roles: await roleService.list(), groups: configService.getDraft().selfRoleGroups });
  }));
  r.post('/roles/check', asyncRoute(async (req, res) => {
    const { roleId } = z.object({ roleId: z.string() }).parse(req.body);
    res.json(await roleService.checkAddSelfRole(roleId));
  }));

  // ── Role Manager (operates on the real 43-role audit snapshot) ───────
  r.get('/roles/manager', asyncRoute(async (_req, res) => {
    if (!roleManagerService.available()) {
      res.json({ available: false, message: 'No role snapshot yet. Run `npm run audit:roles`, then reload.' });
      return;
    }
    res.json({ available: true, ...roleManagerService.view() });
  }));
  r.post('/roles/manager/edit', asyncRoute(async (req, res) => {
    const { roleId, edit } = z.object({
      roleId: z.string(),
      edit: z.object({
        name: z.string().max(100).optional(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        hoist: z.boolean().optional(),
        mentionable: z.boolean().optional(),
        permsAdd: z.array(z.string()).optional(),
        permsRemove: z.array(z.string()).optional(),
        protectedOverride: z.boolean().optional(),
      }),
    }).parse(req.body);
    roleManagerService.saveEdit(roleId, edit);
    auditService.record('Role edit staged', { module: 'roles', detail: roleId });
    res.json({ ok: true, hasDraft: roleManagerService.hasDraft() });
  }));
  r.post('/roles/manager/order', asyncRoute(async (req, res) => {
    const { order } = z.object({ order: z.array(z.string()) }).parse(req.body);
    roleManagerService.saveOrder(order);
    auditService.record('Role hierarchy reordered (draft)', { module: 'roles' });
    res.json({ ok: true, hasDraft: roleManagerService.hasDraft() });
  }));
  r.get('/roles/manager/diff', asyncRoute(async (_req, res) => res.json({ ops: roleManagerService.diff() })));
  r.get('/roles/manager/warnings', asyncRoute(async (_req, res) => res.json({ warnings: roleManagerService.warnings() })));
  r.get('/roles/manager/bots', asyncRoute(async (_req, res) => res.json({ bots: roleManagerService.botAnalysis() })));
  r.post('/roles/manager/discard', asyncRoute(async (_req, res) => { roleManagerService.discard(); res.json({ ok: true }); }));
  r.post('/roles/manager/apply', asyncRoute(async (_req, res) => {
    const ops = roleManagerService.diff();
    // Hard-blocked while LIVE MUTATIONS are locked. Shows what WOULD run.
    liveLock.assert(`Applying ${ops.length} role change(s)`); // throws 423
    res.json({ ok: true, ops }); // (unreachable while locked)
  }));

  // ── Apply Engine (first-deployment plan; execute stays locked) ───────
  r.get('/roles/apply', asyncRoute(async (_req, res) => {
    if (!roleManagerService.available()) { res.json({ available: false, message: 'Run `npm run audit:roles` first.' }); return; }
    res.json({
      available: true,
      ...applyEngineService.plan(),
      bots: applyEngineService.botPositions(),
      lock: liveLock.status(),
      lastSnapshot: appSettingsRepo.get(`lastSnapshot:${activeGuildId()}`),
    });
  }));
  r.post('/roles/apply/toggle', asyncRoute(async (req, res) => {
    const { opId, selected } = z.object({ opId: z.string(), selected: z.boolean() }).parse(req.body);
    applyEngineService.toggle(opId, selected);
    res.json(applyEngineService.plan());
  }));
  r.post('/roles/apply/reset', asyncRoute(async (_req, res) => { applyEngineService.reset(); res.json(applyEngineService.plan()); }));
  r.post('/roles/apply/snapshot', asyncRoute(async (_req, res) => {
    const audit = roleManagerService.loadAudit();
    const stamp = new Date().toISOString();
    const path = applyEngineService.snapshot(audit.roles, stamp);
    appSettingsRepo.set(`lastSnapshot:${activeGuildId()}`, path);
    auditService.record('Rollback snapshot created', { module: 'roles', detail: path });
    res.json({ path, source: 'last audit:roles capture', takenAt: stamp, note: 'The CLI apply re-snapshots LIVE state first as the authoritative rollback.' });
  }));
  r.post('/roles/apply/validate', asyncRoute(async (_req, res) => {
    const audit = roleManagerService.loadAudit();
    const v = applyEngineService.validateLive(audit.roles); // light check vs snapshot
    res.json({ ...v, validatedAt: new Date().toISOString(), note: 'Authoritative live validation + drift check runs inside `npm run roles:apply` against the live server.' });
  }));
  r.post('/roles/apply/execute', asyncRoute(async (_req, res) => {
    const { counts } = applyEngineService.plan();
    liveLock.assert('Applying role changes'); // throws 423 while locked
    res.json({ ok: true, counts }); // unreachable while locked
  }));

  // ── moderation ───────────────────────────────────────────────────────
  r.get('/moderation', asyncRoute(async (_req, res) => {
    const cfg = configService.getDraft();
    res.json({
      staffRoleIds: cfg.staffRoleIds,
      logChannel: cfg.logChannels.moderation ?? null,
      recentCases: recentModCases(),
    });
  }));

  // ── tickets ──────────────────────────────────────────────────────────
  r.get('/tickets', asyncRoute(async (_req, res) => {
    const cfg = configService.getDraft();
    const list = ticketList();
    res.json({
      config: {
        panelChannelId: cfg.ticketPanelChannelId ?? null,
        parentCategoryId: cfg.ticketParentCategoryId ?? null,
        archiveCategoryId: cfg.ticketArchiveCategoryId ?? null,
        logChannelId: cfg.ticketLogChannelId ?? null,
        staffRoleIds: cfg.ticketStaffRoleIds,
        cooldownSec: cfg.ticketCreateCooldownSec,
        deleteDelay: cfg.ticketDeleteDelay,
        categories: cfg.ticketCategories,
      },
      stats: {
        open: list.filter((t) => t.status === 'open').length,
        claimed: list.filter((t) => t.status === 'open' && t.claimedBy).length,
        unclaimed: list.filter((t) => t.status === 'open' && !t.claimedBy).length,
        closed: list.filter((t) => t.status === 'closed').length,
      },
      tickets: list,
    });
  }));

  // ── logging matrix ───────────────────────────────────────────────────
  r.get('/logging', asyncRoute(async (_req, res) => {
    res.json({ logChannels: configService.getDraft().logChannels });
  }));

  // ── server inspector ─────────────────────────────────────────────────
  r.get('/server', asyncRoute(async (_req, res) => {
    const snap = await getDataSource().snapshot();
    res.json({ ...snap, otherBots: SAMPLE_OTHER_BOTS, issues: await inspectIssues() });
  }));

  // ── diagnostics ──────────────────────────────────────────────────────
  r.get('/diagnostics', asyncRoute(async (_req, res) => res.json(await runDiagnostics())));

  // ── database ─────────────────────────────────────────────────────────
  r.get('/database', asyncRoute(async (_req, res) => res.json(databaseService.stats())));
  r.post('/database/backup', asyncRoute(async (_req, res) => {
    const out = databaseService.backup();
    auditService.record('Database backup created', { module: 'database', result: 'ok' });
    res.json(out);
  }));
  r.post('/database/migrate', asyncRoute(async (_req, res) => {
    const out = databaseService.migrate();
    auditService.record('Migrations run', { module: 'database', result: 'ok', detail: `schema v${out.schemaVersion}` });
    res.json(out);
  }));

  // ── settings / export-import ─────────────────────────────────────────
  r.get('/settings/export', asyncRoute(async (_req, res) => res.json(exportService.build())));
  r.post('/settings/import/preview', asyncRoute(async (req, res) => res.json(exportService.preview(req.body))));
  r.post('/settings/import/apply', asyncRoute(async (req, res) => {
    configService.snapshot('before import');
    const applied = exportService.apply(req.body);
    auditService.record('Configuration imported', { module: 'settings', result: 'ok' });
    res.json({ applied });
  }));

  // ── version / migration page ─────────────────────────────────────────
  r.get('/version', asyncRoute(async (_req, res) => {
    const db = databaseService.stats();
    res.json({
      app: APP_VERSION,
      schema: { applied: db.schemaVersion, latest: db.latestSchemaVersion, pending: db.pending },
      modules: MODULES.map((m) => ({ name: m.name, version: m.version })),
      updateRequired: db.pending.length > 0,
    });
  }));

  // ── secret storage (token) ───────────────────────────────────────────
  r.get('/secret/status', asyncRoute(async (_req, res) => res.json(secretStore.meta())));
  r.post('/secret/token', asyncRoute(async (req, res) => {
    const { token, applicationId, guildId } = z.object({
      token: z.string().min(20, 'Token looks too short'),
      applicationId: z.string().regex(/^\d{15,25}$/, 'Application ID must be a numeric snowflake').optional(),
      guildId: z.string().regex(/^\d{15,25}$/, 'Guild ID must be a numeric snowflake').optional(),
    }).parse(req.body);
    secretStore.setToken(token);
    if (applicationId) credentials.setApplicationId(applicationId);
    if (guildId) credentials.setGuildId(guildId);
    auditService.record('Bot credentials updated', { module: 'bot', result: 'ok', detail: 'token stored (encrypted)' });
    res.json({ ok: true, meta: secretStore.meta(), credentials: credentials.status() }); // never returns the token
  }));
  r.post('/secret/ids', asyncRoute(async (req, res) => {
    const { applicationId, guildId } = z.object({
      applicationId: z.string().regex(/^\d{15,25}$/).optional(),
      guildId: z.string().regex(/^\d{15,25}$/).optional(),
    }).parse(req.body);
    if (applicationId) credentials.setApplicationId(applicationId);
    if (guildId) credentials.setGuildId(guildId);
    res.json({ credentials: credentials.status() });
  }));
  r.post('/secret/test', asyncRoute(async (_req, res) => {
    // Read-only identify (no gateway, no writes). Approved in the connection phase.
    res.json(await connectionService.testCredentials());
  }));

  return r;
}

// ── helpers (DB-backed, empty pre-connection) ──────────────────────────
function ticketList() {
  try {
    return ticketsRepo.listAllOpen();
  } catch {
    return [];
  }
}
function recentModCases() {
  return [] as unknown[];
}
function recentActivity() {
  return [
    { icon: '🟢', text: 'Control Center started (mock data)', when: 'just now' },
    { icon: '🗄️', text: 'Database schema validated', when: 'just now' },
  ];
}
async function inspectIssues() {
  const snap = await getDataSource().snapshot();
  const cfg = configService.getApplied();
  const issues: { level: 'warn' | 'error'; text: string }[] = [];
  const selfRoleIds = cfg.selfRoleGroups.flatMap((g) => g.roles.map((r) => r.roleId));
  for (const id of selfRoleIds) {
    const role = snap.roles.find((r) => r.id === id);
    if (!role) issues.push({ level: 'error', text: `Configured self-role ${id} no longer exists` });
    else if (role.position >= snap.bot.topRolePosition) issues.push({ level: 'error', text: `Self-role "${role.name}" is above the bot` });
  }
  if (!cfg.welcomeChannelId) issues.push({ level: 'warn', text: 'Welcome channel not configured' });
  if (!cfg.ticketParentCategoryId) issues.push({ level: 'warn', text: 'Ticket parent category not configured' });
  // duplicate channel names
  const seen = new Map<string, number>();
  for (const c of snap.channels) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  for (const [name, n] of seen) if (n > 1) issues.push({ level: 'warn', text: `Duplicate channel name: #${name} (${n})` });
  return issues;
}
