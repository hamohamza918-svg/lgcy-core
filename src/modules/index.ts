import type { Module } from '../types/index.js';
import { systemModule } from './system/index.js';
import { welcomeModule } from './welcome/index.js';
import { rolesModule } from './roles/index.js';
import { moderationModule } from './moderation/index.js';
import { loggingModule } from './logging/index.js';
import { ticketsModule } from './tickets/index.js';
import { voiceModule } from './voice/index.js';

/**
 * THE module registry. Adding a new feature to LGCY Core = writing a module and
 * adding one line here. Nothing else in the core changes. Order only affects
 * load logging; per-guild toggles decide what actually runs.
 */
export const MODULES: Module[] = [
  systemModule, // diagnostics + module toggles (always on)
  welcomeModule, // welcome cards + join/leave
  rolesModule, // self-roles
  moderationModule, // moderation toolkit
  loggingModule, // audit logging
  ticketsModule, // foundation (disabled)
  voiceModule, // dormant (disabled)
];
