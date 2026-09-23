import { runDiagnostics } from './diagnosticsService.js';

export type OverallStatus = 'HEALTHY' | 'WARNING' | 'ERROR';

/**
 * One overall system-health verdict derived from the full diagnostic across
 * bot, gateway, database, configuration, modules, permissions, hierarchy,
 * migrations, and secrets. Warnings (e.g. "not connected yet") are expected in
 * the local phase and surface as WARNING, not ERROR.
 */
// Short cache so the header health badge (refreshed on every navigation) doesn't
// re-run the full diagnostic on rapid page switches.
let cache: { at: number; value: { status: OverallStatus; counts: { ok: number; warn: number; error: number } } } | null = null;
const TTL_MS = 5000;

export async function systemHealth(): Promise<{ status: OverallStatus; counts: { ok: number; warn: number; error: number } }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const { summary } = await runDiagnostics();
  const status: OverallStatus = summary.error > 0 ? 'ERROR' : summary.warn > 0 ? 'WARNING' : 'HEALTHY';
  const value = { status, counts: summary };
  cache = { at: Date.now(), value };
  return value;
}
