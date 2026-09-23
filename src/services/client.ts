import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import type { Command, Module } from '../types/index.js';

/**
 * Extended Discord client that carries the bot's registries. The intents below
 * are the minimum required for Phase-1 features — we request only what we use
 * (see the permissions/intents summary in the README). Add intents here only
 * when a module actually needs them.
 */
export class LgcyClient extends Client {
  /** name → command */
  readonly commands = new Collection<string, Command>();
  /** name → module */
  readonly modules = new Collection<string, Module>();

  constructor() {
    super({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // welcome/leave, role & nickname logs
        GatewayIntentBits.GuildMessages, // message delete/edit logs
        // MessageContent (privileged) — AUDITED & REQUIRED: the logging module's
        // messageDelete / messageUpdate handlers record the deleted/edited text.
        // Without this intent that content arrives empty over the gateway, so the
        // logs would be useless. Ticket transcripts also rely on message content.
        // Kept deliberately; do not remove without dropping message-content logging.
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates, // voice logs + future temp voice
        GatewayIntentBits.GuildModeration, // ban/unban logs
      ],
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
      ],
    });
  }
}
