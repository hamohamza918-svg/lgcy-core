import { Events, type NonThreadGuildBasedChannel } from 'discord.js';
import type { Module, EventHandler } from '../../types/index.js';
import type { LgcyClient } from '../../services/client.js';
import { ticketsRepo } from '../../database/repositories/ticketsRepo.js';
import { ticketsCommand } from './commands.js';
import { handleTicketsComponent } from './interactions.js';
import { scopedLogger } from '../../utils/logger.js';

const log = scopedLogger('tickets');

/**
 * If a ticket channel is deleted out-of-band, mark the ticket closed so state
 * stays consistent with reality.
 */
const channelDeleteCleanup: EventHandler<Events.ChannelDelete> = {
  name: Events.ChannelDelete,
  module: 'tickets',
  execute(_client, channel: NonThreadGuildBasedChannel | import('discord.js').DMChannel) {
    if (!('guild' in channel)) return;
    const ticket = ticketsRepo.getByChannel(channel.id);
    if (ticket && ticket.status === 'open') {
      ticketsRepo.close(ticket.id, 'system', 'Channel deleted');
      log.info({ ticketId: ticket.id }, 'ticket auto-closed (channel deleted)');
    }
  },
};

/**
 * Tickets module — button/select-driven support tickets with claim, close (with
 * confirmation + reason), add/remove member, transfer, and HTML transcripts.
 *
 * RESTART RECOVERY: all ticket state lives in the DB and every control encodes
 * its ticket id in the customId, so buttons keep working after a restart with no
 * in-memory registry. init() simply reports how many tickets are still open.
 */
export const ticketsModule: Module = {
  name: 'tickets',
  description: 'Button-based support tickets with transcripts, claim/close, and full logging.',
  version: '1.0.0',
  defaultEnabled: true,
  dashboard: { icon: '🎫', section: 'tickets', configurable: true },
  commands: [ticketsCommand],
  events: [channelDeleteCleanup],
  handleComponent: handleTicketsComponent,
  init(client: LgcyClient) {
    // Recovery is implicit (DB-backed); log open tickets for visibility.
    client.once(Events.ClientReady, () => {
      const open = ticketsRepo.listAllOpen().length;
      if (open > 0) log.info({ openTickets: open }, 'ticket state recovered from database');
    });
  },
};
