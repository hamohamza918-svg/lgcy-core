import type { LgcyClient } from './client.js';
import type { Module } from '../types/index.js';
import { isFeatureEnabled } from '../config/guildConfig.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('module-loader');

/**
 * Registers a set of modules onto the client:
 *  - collects their commands into the command registry,
 *  - wires their gateway event handlers (gated by per-guild feature toggles),
 *  - runs their init hook.
 *
 * Adding a feature = adding a module to the registry. The core loader never
 * changes.
 */
export async function loadModules(
  client: LgcyClient,
  modules: Module[],
): Promise<void> {
  for (const mod of modules) {
    client.modules.set(mod.name, mod);

    // Commands
    for (const cmd of mod.commands ?? []) {
      cmd.module = mod.name;
      if (client.commands.has(cmd.data.name)) {
        log.warn(
          { command: cmd.data.name, module: mod.name },
          'duplicate command name — overwriting',
        );
      }
      client.commands.set(cmd.data.name, cmd);
    }

    // Events — each handler is gated by the module's feature toggle per guild.
    for (const handler of mod.events ?? []) {
      const wrapped = async (...args: unknown[]) => {
        // Resolve a guild id from common event payload shapes to check the toggle.
        const guildId = extractGuildId(args);
        if (
          guildId &&
          !isFeatureEnabled(guildId, mod.name, mod.defaultEnabled)
        ) {
          return;
        }
        try {
          // @ts-expect-error — variadic event args are validated by discord.js typings at the call site.
          await handler.execute(client, ...args);
        } catch (err) {
          log.error(
            { err, event: handler.name, module: mod.name },
            'event handler threw',
          );
        }
      };
      if (handler.once) client.once(handler.name, wrapped);
      else client.on(handler.name, wrapped);
    }

    if (mod.init) {
      await mod.init(client);
    }

    log.info(
      {
        module: mod.name,
        commands: mod.commands?.length ?? 0,
        events: mod.events?.length ?? 0,
        defaultEnabled: mod.defaultEnabled,
      },
      'module loaded',
    );
  }
}

/** Best-effort guild-id extraction from an arbitrary event payload. */
function extractGuildId(args: unknown[]): string | null {
  for (const a of args) {
    if (a && typeof a === 'object') {
      const g = (a as { guild?: { id?: string }; guildId?: string });
      if (g.guildId) return g.guildId;
      if (g.guild?.id) return g.guild.id;
    }
  }
  return null;
}
