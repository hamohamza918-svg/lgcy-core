import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
  ClientEvents,
  PermissionResolvable,
  AutocompleteInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import type { LgcyClient } from '../services/client.js';

/**
 * A slash command. Every command declares the Discord permissions it needs so
 * the loader can validate the bot's own permissions and the runtime can gate
 * usage — we never rely on the blanket Administrator permission.
 */
export interface Command {
  /** The builder describing the slash command (name, options, default perms). */
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;
  /** Discord permissions the invoking member must hold. Checked at runtime. */
  memberPermissions?: PermissionResolvable[];
  /** Discord permissions the bot must hold in the guild/channel to run this. */
  botPermissions?: PermissionResolvable[];
  /** Whether the command should be usable in DMs. Defaults to false. */
  allowInDMs?: boolean;
  /** The module this command belongs to (for logging / diagnostics). */
  module?: string;
  execute(
    interaction: ChatInputCommandInteraction,
    client: LgcyClient,
  ): Promise<void> | void;
  autocomplete?(
    interaction: AutocompleteInteraction,
    client: LgcyClient,
  ): Promise<void> | void;
}

/** Any component (button / select / user-select / modal) interaction a module
 * may be asked to handle. */
export type ComponentInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

/** A gateway event handler. */
export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  name: K;
  once?: boolean;
  module?: string;
  execute(
    client: LgcyClient,
    ...args: ClientEvents[K]
  ): Promise<void> | void;
}

/**
 * A feature module. Everything the bot does lives inside a module so the core
 * never needs to change when a feature is added. A module contributes commands,
 * event handlers, and component interaction handlers, and can register itself
 * on startup.
 */
/**
 * Dashboard metadata a module exposes so the Control Center can render a
 * section for it automatically — a new module appears in the UI with no
 * changes to the control center itself.
 */
export interface ModuleDashboard {
  /** Emoji/icon shown on the module card. */
  icon: string;
  /** Sidebar/route key the module maps to (e.g. "welcome"). */
  section: string;
  /** Whether the module has a configuration page. */
  configurable: boolean;
  /** Other module names this one depends on. */
  dependencies?: string[];
}

export interface Module {
  /** Stable identifier, e.g. "welcome". Used as the config feature key. */
  name: string;
  /** Human-friendly description shown in diagnostics. */
  description: string;
  /** Semantic version of the module, surfaced in the dashboard. */
  version: string;
  /** Optional dashboard metadata (icon, section, dependencies). */
  dashboard?: ModuleDashboard;
  /** Discord permission names this module needs (for the permissions audit). */
  permissions?: string[];
  /**
   * Optional metadata-driven config descriptor. Simple modules can describe
   * their settings here and be rendered generically by the Control Center;
   * complex modules provide their own page instead. Kept as an opaque record so
   * the core never depends on a specific schema library.
   */
  configSchema?: Record<string, unknown>;
  /** Optional self-health check surfaced on the module card. */
  healthCheck?: () => { status: 'ok' | 'warn' | 'error'; detail?: string };
  /**
   * Whether this module is enabled by default when a guild has no explicit
   * setting. Modules that must stay dormant (e.g. temp-voice until the old
   * private-room system is understood) default to false.
   */
  defaultEnabled: boolean;
  commands?: Command[];
  events?: EventHandler[];
  /**
   * Handles a component (button / select / modal) interaction whose customId
   * belongs to this module. Return true if handled.
   */
  handleComponent?(
    interaction: ComponentInteraction,
    client: LgcyClient,
  ): Promise<boolean> | boolean;
  /** One-time setup when the module is loaded (optional). */
  init?(client: LgcyClient): Promise<void> | void;
}

/**
 * customIds follow the convention `module:action:...args` so the router can
 * dispatch a component interaction to the owning module without a central
 * registry of every button.
 */
export function buildCustomId(module: string, action: string, ...args: string[]): string {
  return [module, action, ...args].join(':');
}

export function parseCustomId(customId: string): {
  module: string;
  action: string;
  args: string[];
} {
  const [module = '', action = '', ...args] = customId.split(':');
  return { module, action, args };
}
