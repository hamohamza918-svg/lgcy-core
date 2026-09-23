import { ChannelType, type Client, type GuildBasedChannel } from 'discord.js';
import type { DiscordDataSource, DiscordSnapshot, DiscordChannel } from './types.js';

/**
 * LIVE, READ-ONLY Discord data source. Reads bot identity, guild, channels,
 * categories, roles, hierarchy, and the bot's own permissions. It performs NO
 * writes of any kind — it only reads.
 *
 * Note: per-role member counts require the privileged GuildMembers intent,
 * which we deliberately DO NOT request for read-only discovery. Those counts are
 * reported as 0/unknown live; server-level counts come from the guild object.
 */
function mapChannelType(t: ChannelType): DiscordChannel['type'] {
  switch (t) {
    case ChannelType.GuildCategory: return 'category';
    case ChannelType.GuildVoice:
    case ChannelType.GuildStageVoice: return 'voice';
    case ChannelType.GuildAnnouncement: return 'announcement';
    case ChannelType.GuildForum:
    case ChannelType.GuildMedia: return 'forum';
    default: return 'text';
  }
}

export class LiveDiscordSource implements DiscordDataSource {
  readonly source = 'live' as const;
  private cached: { at: number; snap: DiscordSnapshot } | null = null;
  private static readonly TTL_MS = 8000;
  constructor(private readonly client: Client, private readonly guildId: string) {}

  async snapshot(): Promise<DiscordSnapshot> {
    if (this.cached && Date.now() - this.cached.at < LiveDiscordSource.TTL_MS) return this.cached.snap;
    const client = this.client;
    // Read from the gateway CACHE (populated by the Guilds intent at connect).
    // No per-request REST fetches — those can hang if the gateway drops.
    const guild = client.guilds.cache.get(this.guildId) ?? (await client.guilds.fetch(this.guildId));
    const me = guild.members.me ?? (await guild.members.fetchMe());

    const channels: DiscordChannel[] = [...guild.channels.cache.values()]
      .filter((c): c is GuildBasedChannel => !!c)
      .map((c) => ({
        id: c.id,
        name: c.name,
        type: mapChannelType(c.type),
        parentId: 'parentId' in c ? (c.parentId ?? null) : null,
        position: 'position' in c ? c.position : 0,
      }));

    const roles = [...guild.roles.cache.values()].map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      position: r.position,
      managed: r.managed,
      memberCount: r.members.size, // 0 without the members intent (by design)
      hasAdministrator: r.permissions.has('Administrator'),
    }));

    const nonCategory = channels.filter((c) => c.type !== 'category');
    const botCount = [...guild.members.cache.values()].filter((m) => m.user.bot).length;

    const snap: DiscordSnapshot = {
      connected: true,
      source: 'live',
      bot: {
        username: client.user?.username ?? 'LGCY Core',
        discriminator: client.user?.discriminator ?? '0',
        id: client.user?.id ?? '0',
        avatarUrl: client.user?.displayAvatarURL({ size: 128 }) ?? null,
        topRolePosition: me.roles.highest.position,
      },
      guild: {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        channelCount: nonCategory.length,
        roleCount: roles.length,
        botCount: botCount || 0,
      },
      channels,
      roles,
      gatewayPingMs: Math.max(0, Math.round(client.ws.ping)),
    };
    this.cached = { at: Date.now(), snap };
    return snap;
  }
}
