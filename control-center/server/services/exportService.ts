import { guildConfigSchema, setGuildConfig, type GuildConfig } from '../../../src/config/guildConfig.js';
import { redactDeep } from '../../../src/services/redact.js';
import { APP_VERSION } from '../../../src/config/version.js';
import { configService, activeGuildId } from './configService.js';

export interface ConfigExport {
  app: 'LGCY Control Center';
  version: string;
  exportedAt: string;
  guildId: string;
  config: GuildConfig;
}

function diffConfigs(a: Record<string, unknown>, b: Record<string, unknown>) {
  const out: { path: string; from: unknown; to: unknown }[] = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ path: k, from: a[k], to: b[k] });
  }
  return out;
}

export const exportService = {
  /** Non-secret config export. Redacted as defence-in-depth — never contains
   * the token, keys, or credentials (those live in the secret store, not here). */
  build(): ConfigExport {
    const payload: ConfigExport = {
      app: 'LGCY Control Center',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      guildId: activeGuildId(),
      config: configService.getApplied(),
    };
    return redactDeep(payload);
  },

  /** Validate + preview an import without applying it. */
  preview(raw: unknown): { ok: boolean; errors: string[]; diff: { path: string; from: unknown; to: unknown }[] } {
    const config = (raw as { config?: unknown })?.config ?? raw;
    const parsed = guildConfigSchema.safeParse(config);
    if (!parsed.success) {
      return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`), diff: [] };
    }
    const diff = diffConfigs(
      configService.getApplied() as Record<string, unknown>,
      parsed.data as Record<string, unknown>,
    );
    return { ok: true, errors: [], diff };
  },

  /** Apply a validated import to the active guild config. */
  apply(raw: unknown): GuildConfig {
    const config = (raw as { config?: unknown })?.config ?? raw;
    const parsed = guildConfigSchema.parse(config);
    return setGuildConfig(activeGuildId(), parsed);
  },
};
