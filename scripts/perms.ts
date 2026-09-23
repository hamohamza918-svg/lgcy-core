/**
 * Prints the minimum invite-permissions integer for LGCY Core Phase 1 and the
 * module that needs each permission. No Administrator. No network.
 * Run: `npm run perms`.
 */
import {
  REQUIRED_PERMISSIONS,
  DROPPED_PERMISSIONS,
  requiredPermissionsBitfield,
} from '../src/config/requiredPermissions.js';

const bits = requiredPermissionsBitfield();
/* eslint-disable no-console */
console.log('LGCY CORE — minimum bot permissions (Phase 1)\n');
for (const r of REQUIRED_PERMISSIONS) console.log(`  + ${r.name.padEnd(22)} — ${r.why}`);
console.log('\nDROPPED:');
for (const d of DROPPED_PERMISSIONS) console.log(`  x ${d}`);
console.log('\nPermissions integer:', bits.bitfield.toString());
console.log('Names:', bits.toArray().join(', '));
/* eslint-enable no-console */
