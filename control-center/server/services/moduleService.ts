import { MODULES } from '../../../src/modules/index.js';
import { isFeatureEnabled, updateGuildConfig } from '../../../src/config/guildConfig.js';
import { activeGuildId } from './configService.js';

export interface ModuleView {
  name: string;
  description: string;
  version: string;
  icon: string;
  section: string;
  configurable: boolean;
  dependencies: string[];
  enabled: boolean;
  defaultEnabled: boolean;
  commands: number;
  events: number;
  status: 'enabled' | 'disabled';
  health: 'ok' | 'warn' | 'error';
  healthDetail: string | null;
  permissions: string[];
  lastError: string | null;
}

export const moduleService = {
  list(): ModuleView[] {
    const gid = activeGuildId();
    return MODULES.map((m) => {
      const enabled = isFeatureEnabled(gid, m.name, m.defaultEnabled);
      const health = m.healthCheck ? m.healthCheck() : { status: 'ok' as const, detail: undefined };
      return {
        name: m.name,
        description: m.description,
        version: m.version,
        icon: m.dashboard?.icon ?? '📦',
        section: m.dashboard?.section ?? m.name,
        configurable: m.dashboard?.configurable ?? false,
        dependencies: m.dashboard?.dependencies ?? [],
        enabled,
        defaultEnabled: m.defaultEnabled,
        commands: m.commands?.length ?? 0,
        events: m.events?.length ?? 0,
        status: enabled ? 'enabled' : 'disabled',
        health: health.status,
        healthDetail: health.detail ?? null,
        permissions: m.permissions ?? [],
        lastError: null,
      };
    });
  },

  /** Toggle a module for the active guild. The voice module cannot be enabled
   * here — it stays dormant until its Private-voice review is done. */
  setEnabled(name: string, enabled: boolean): ModuleView {
    const mod = MODULES.find((m) => m.name === name);
    if (!mod) throw new Error('Unknown module.');
    if (name === 'voice' && enabled) {
      throw new Error('The Private Voice module is intentionally locked and cannot be enabled yet.');
    }
    updateGuildConfig(activeGuildId(), (d) => {
      d.features[name] = enabled;
    });
    return this.list().find((m) => m.name === name)!;
  },
};
