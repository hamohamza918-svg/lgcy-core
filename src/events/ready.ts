import { ActivityType, Events } from 'discord.js';
import type { EventHandler } from '../types/index.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('ready');

/** Core event: fired once when the gateway connection is established. */
export const readyEvent: EventHandler<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    const user = client.user;
    if (!user) return;
    user.setPresence({
      activities: [{ name: 'the LGCY community', type: ActivityType.Watching }],
      status: 'online',
    });
    log.info(
      {
        tag: user.tag,
        id: user.id,
        guilds: client.guilds.cache.size,
        commands: client.commands.size,
        modules: client.modules.size,
      },
      'LGCY Core is online',
    );
  },
};
