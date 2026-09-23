import { secretStore } from '../services/secretStore.js';
import { appSettingsRepo } from '../database/repositories/appSettingsRepo.js';
import { loadEnv } from './env.js';

/**
 * Single resolver for the bot's credentials, unifying the Control Center's
 * managed storage with env fallbacks:
 *   - token  → encrypted secret store  (fallback: env DISCORD_TOKEN)
 *   - appId  → app_settings            (fallback: env DISCORD_CLIENT_ID)
 *   - guild  → app_settings            (fallback: env GUILD_ID)
 *
 * The token is only ever returned by getToken() (used by the bot at login) —
 * never surfaced to the dashboard.
 */

const KEY_APP_ID = 'discord.applicationId';
const KEY_GUILD_ID = 'discord.guildId';

export const credentials = {
  getToken(): string | null {
    const env = loadEnv();
    if (env.DISCORD_TOKEN) return env.DISCORD_TOKEN;
    return secretStore.getToken();
  },

  hasToken(): boolean {
    return !!loadEnv().DISCORD_TOKEN || secretStore.hasToken();
  },

  getApplicationId(): string | null {
    return appSettingsRepo.get(KEY_APP_ID) ?? loadEnv().DISCORD_CLIENT_ID ?? null;
  },

  getGuildId(): string | null {
    return appSettingsRepo.get(KEY_GUILD_ID) ?? loadEnv().GUILD_ID ?? null;
  },

  setApplicationId(id: string): void {
    appSettingsRepo.set(KEY_APP_ID, id.trim());
  },

  setGuildId(id: string): void {
    appSettingsRepo.set(KEY_GUILD_ID, id.trim());
  },

  /** Frontend-safe status — never includes the token value. */
  status(): { hasToken: boolean; applicationId: string | null; guildId: string | null } {
    return {
      hasToken: this.hasToken(),
      applicationId: this.getApplicationId(),
      guildId: this.getGuildId(),
    };
  },

  /** True when the minimum needed to attempt a connection is present. */
  isConfigured(): boolean {
    return this.hasToken() && !!this.getApplicationId() && !!this.getGuildId();
  },
};
