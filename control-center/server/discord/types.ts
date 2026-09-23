/** Normalized, read-only shapes the dashboard consumes — from mock data now,
 * from the live gateway later. Kept minimal and UI-focused. */

export interface DiscordChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'category' | 'forum' | 'announcement';
  parentId: string | null;
  position: number;
}

export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
  memberCount: number;
  hasAdministrator: boolean;
}

export interface DiscordBotIdentity {
  username: string;
  discriminator: string;
  id: string;
  avatarUrl: string | null;
  topRolePosition: number;
}

export interface DiscordGuildSummary {
  id: string;
  name: string;
  memberCount: number;
  channelCount: number;
  roleCount: number;
  botCount: number;
}

export interface DiscordSnapshot {
  connected: boolean;
  source: 'mock' | 'live';
  bot: DiscordBotIdentity;
  guild: DiscordGuildSummary;
  channels: DiscordChannel[];
  roles: DiscordRole[];
  gatewayPingMs: number | null;
}

/** A source of read-only Discord data for the dashboard. */
export interface DiscordDataSource {
  readonly source: 'mock' | 'live';
  snapshot(): Promise<DiscordSnapshot>;
}
