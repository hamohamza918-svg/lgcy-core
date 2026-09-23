import type { Module } from '../../types/index.js';
import { rolesCommand } from './commands.js';
import { handleRolesComponent } from './interactions.js';

/**
 * Roles module — button/select self-role assignment from EXISTING server roles.
 * Designed to grow into multiple groups (Games, Notifications, Interests,
 * Events). Staff/security roles are structurally blocked from ever being
 * offered (see selfRoleBlockReason).
 *
 * Seed groups (Games: FiveM, Minecraft, ARK, FIFA, Overwatch) are wired to the
 * real, existing role IDs via `/roles add` once we connect — no duplicate roles
 * are ever created.
 */
export const rolesModule: Module = {
  name: 'roles',
  description: 'Self-assignable role groups via select menus.',
  version: '1.0.0',
  defaultEnabled: true,
  dashboard: { icon: '🎭', section: 'roles', configurable: true },
  commands: [rolesCommand],
  handleComponent: handleRolesComponent,
};
