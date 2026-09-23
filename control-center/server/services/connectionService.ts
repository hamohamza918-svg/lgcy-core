import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { credentials } from '../../../src/config/credentials.js';
import { redactString } from '../../../src/services/redact.js';
import { scopedLogger } from '../../../src/utils/logger.js';
import { setDataSource, getDataSource } from '../discord/index.js';
import { MockDiscordSource } from '../discord/mockSource.js';
import { LiveDiscordSource } from '../discord/liveSource.js';

const log = scopedLogger('connection');

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ConnectionStatus {
  state: ConnState;
  since: string | null;
  guildName: string | null;
  error: string | null;
  source: 'mock' | 'live';
  credentials: { hasToken: boolean; applicationId: string | null; guildId: string | null };
}

let client: Client | null = null;
let state: ConnState = 'disconnected';
let since: string | null = null;
let lastError: string | null = null;
let guildName: string | null = null;

function safe(err: unknown): string {
  return redactString(err instanceof Error ? err.message : String(err));
}

export const connectionService = {
  status(): ConnectionStatus {
    return {
      state,
      since,
      guildName,
      error: lastError,
      source: getDataSource().source,
      credentials: credentials.status(),
    };
  },

  /**
   * Verifies the credentials with a READ-ONLY REST identify. Opens no gateway,
   * changes nothing. Returns the bot + guild identity for display.
   */
  async testCredentials(): Promise<{ ok: boolean; bot?: { username: string; id: string }; guild?: { name: string; memberCount: number }; message: string }> {
    const token = credentials.getToken();
    const guildId = credentials.getGuildId();
    if (!token) return { ok: false, message: 'No bot token stored. Enter it in Setup first.' };
    try {
      const rest = new REST({ version: '10' }).setToken(token);
      const me = (await rest.get(Routes.user('@me'))) as { username: string; id: string };
      let guild: { name: string; memberCount: number } | undefined;
      if (guildId) {
        const g = (await rest.get(`/guilds/${guildId}` as `/${string}`, { query: new URLSearchParams({ with_counts: 'true' }) })) as { name: string; approximate_member_count?: number };
        guild = { name: g.name, memberCount: g.approximate_member_count ?? 0 };
      }
      return { ok: true, bot: { username: me.username, id: me.id }, guild, message: 'Credentials verified (read-only). No changes were made.' };
    } catch (err) {
      return { ok: false, message: `Verification failed: ${safe(err)}` };
    }
  },

  /**
   * Opens a READ-ONLY gateway connection (Guilds intent only — no privileged
   * intents, no message/member events) and switches the dashboard to the live
   * data source. Performs no writes.
   */
  async connect(): Promise<ConnectionStatus> {
    if (state === 'connected') return this.status();
    const token = credentials.getToken();
    const guildId = credentials.getGuildId();
    if (!token) throw new Error('No bot token stored. Complete Setup first.');
    if (!guildId) throw new Error('No Guild ID configured. Complete Setup first.');

    state = 'connecting';
    lastError = null;
    const c = new Client({ intents: [GatewayIntentBits.Guilds] }); // read-only discovery only

    // Never let a gateway error/disconnect crash the dashboard process.
    c.on('error', (err) => log.error({ err: safe(err) }, 'read-only client error'));
    c.on('shardError', (err) => log.error({ err: safe(err) }, 'read-only shard error'));
    c.on('warn', (msg) => log.warn({ msg }, 'read-only client warning'));
    c.on('shardDisconnect', () => { state = 'disconnected'; log.warn('read-only shard disconnected'); });
    c.on('shardResume', () => { if (client === c) state = 'connected'; });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Connection timed out.')), 20000);
        c.once('ready', () => { clearTimeout(timer); resolve(); });
        c.login(token).catch((e) => { clearTimeout(timer); reject(e); });
      });

      const guild = await c.guilds.fetch(guildId);
      client = c;
      guildName = guild.name;
      state = 'connected';
      since = new Date().toISOString();
      setDataSource(new LiveDiscordSource(c, guildId));
      log.info({ guild: guild.name }, 'connected read-only');
      return this.status();
    } catch (err) {
      state = 'error';
      lastError = safe(err);
      await c.destroy().catch(() => undefined);
      setDataSource(new MockDiscordSource());
      throw new Error(lastError);
    }
  },

  /** Closes the read-only connection and returns to mock data. */
  async disconnect(): Promise<ConnectionStatus> {
    if (client) { await client.destroy().catch(() => undefined); client = null; }
    state = 'disconnected';
    since = null;
    guildName = null;
    setDataSource(new MockDiscordSource());
    return this.status();
  },

  /** Switch to mock data for development without touching Discord. */
  useMock(): void {
    setDataSource(new MockDiscordSource());
  },

  isConnected(): boolean {
    return state === 'connected';
  },
};
