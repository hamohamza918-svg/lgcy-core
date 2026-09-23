import type { DiscordDataSource, DiscordSnapshot, DiscordChannel, DiscordRole } from './types.js';

/**
 * Realistic sample LGCY server so the entire dashboard is inspectable BEFORE any
 * credentials are entered. No network. IDs are obviously-fake 18-digit strings.
 */

const cat = (id: string, name: string, position: number): DiscordChannel => ({ id, name, type: 'category', parentId: null, position });
const txt = (id: string, name: string, parentId: string, position: number): DiscordChannel => ({ id, name, type: 'text', parentId, position });
const vc = (id: string, name: string, parentId: string, position: number): DiscordChannel => ({ id, name, type: 'voice', parentId, position });

const CHANNELS: DiscordChannel[] = [
  cat('900000000000000001', 'START HERE', 0),
  txt('900000000000000101', 'welcome', '900000000000000001', 0),
  txt('900000000000000102', 'rules', '900000000000000001', 1),
  txt('900000000000000103', 'roles', '900000000000000001', 2),
  txt('900000000000000104', 'announcements', '900000000000000001', 3),

  cat('900000000000000002', 'COMMUNITY', 1),
  txt('900000000000000201', 'general', '900000000000000002', 0),
  txt('900000000000000202', 'gaming', '900000000000000002', 1),
  txt('900000000000000203', 'media', '900000000000000002', 2),
  txt('900000000000000204', 'clips', '900000000000000002', 3),

  cat('900000000000000003', 'SUPPORT', 2),
  txt('900000000000000301', 'support', '900000000000000003', 0),

  cat('900000000000000004', 'TICKETS', 3),
  cat('900000000000000005', 'TICKET ARCHIVE', 4),

  cat('900000000000000006', 'STAFF', 5),
  txt('900000000000000601', 'staff-chat', '900000000000000006', 0),
  txt('900000000000000602', 'member-logs', '900000000000000006', 1),
  txt('900000000000000603', 'message-logs', '900000000000000006', 2),
  txt('900000000000000604', 'mod-logs', '900000000000000006', 3),
  txt('900000000000000605', 'voice-logs', '900000000000000006', 4),
  txt('900000000000000606', 'server-logs', '900000000000000006', 5),
  txt('900000000000000607', 'ticket-logs', '900000000000000006', 6),

  cat('900000000000000007', 'VOICE', 6),
  vc('900000000000000701', 'General VC', '900000000000000007', 0),
  vc('900000000000000702', 'Gaming VC', '900000000000000007', 1),
  vc('900000000000000703', '➕ Join to Create', '900000000000000007', 2),
  vc('900000000000000704', 'Private 1', '900000000000000007', 3),
  vc('900000000000000705', 'Private 2', '900000000000000007', 4),
  vc('900000000000000706', 'Private 3', '900000000000000007', 5),
  vc('900000000000000707', 'Private 4', '900000000000000007', 6),
];

// position: higher = higher in the list. Bot sits at 90, below staff, above games.
const ROLES: DiscordRole[] = [
  { id: '800000000000000001', name: 'Owner', color: 0xe74c3c, position: 100, managed: false, memberCount: 1, hasAdministrator: true },
  { id: '800000000000000002', name: 'Co-Owner', color: 0xe67e22, position: 99, managed: false, memberCount: 1, hasAdministrator: true },
  { id: '800000000000000003', name: 'Admin', color: 0x9b59b6, position: 98, managed: false, memberCount: 3, hasAdministrator: true },
  { id: '800000000000000004', name: 'Moderator', color: 0x3498db, position: 95, managed: false, memberCount: 6, hasAdministrator: false },
  { id: '800000000000000005', name: 'Support', color: 0x1abc9c, position: 94, managed: false, memberCount: 4, hasAdministrator: false },
  { id: '800000000000000010', name: 'LGCY Core', color: 0x2b8cff, position: 90, managed: true, memberCount: 1, hasAdministrator: false },
  { id: '800000000000000020', name: 'FiveM', color: 0xf39c12, position: 40, managed: false, memberCount: 128, hasAdministrator: false },
  { id: '800000000000000021', name: 'Minecraft', color: 0x2ecc71, position: 39, managed: false, memberCount: 203, hasAdministrator: false },
  { id: '800000000000000022', name: 'ARK', color: 0x16a085, position: 38, managed: false, memberCount: 74, hasAdministrator: false },
  { id: '800000000000000023', name: 'FIFA', color: 0x27ae60, position: 37, managed: false, memberCount: 89, hasAdministrator: false },
  { id: '800000000000000024', name: 'Overwatch', color: 0xe67e22, position: 36, managed: false, memberCount: 51, hasAdministrator: false },
  { id: '800000000000000030', name: 'Member', color: 0x95a5a6, position: 10, managed: false, memberCount: 842, hasAdministrator: false },
];

export class MockDiscordSource implements DiscordDataSource {
  readonly source = 'mock' as const;

  async snapshot(): Promise<DiscordSnapshot> {
    return {
      connected: false,
      source: 'mock',
      bot: {
        username: 'LGCY Core',
        discriminator: '0',
        id: '800000000000009999',
        avatarUrl: null,
        topRolePosition: 90,
      },
      guild: {
        id: '900000000000000000',
        name: 'LGCY',
        memberCount: 842,
        channelCount: CHANNELS.filter((c) => c.type !== 'category').length,
        roleCount: ROLES.length,
        botCount: 5,
      },
      channels: CHANNELS,
      roles: ROLES,
      gatewayPingMs: null,
    };
  }
}

/** Known "other bots" present in the sample server (not to be removed yet). */
export const SAMPLE_OTHER_BOTS = ['Boogie', 'Ticket Tool', 'Lara', 'ASCEND', 'MEE6'];
