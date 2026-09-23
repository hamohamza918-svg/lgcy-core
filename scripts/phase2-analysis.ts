/**
 * PHASE 2 ANALYSIS (read-only, no Discord). Computes the proposed hierarchy
 * MOVE diff (3A) and role-permission diff (3B) from the live audit snapshot.
 * IDs are identity. Nothing is mutated.  Run: npm run phase2
 */
import { initDatabase } from '../src/database/index.js';
import { roleManagerService } from '../control-center/server/services/roleManagerService.js';

/* eslint-disable no-console */
initDatabase();
const audit = roleManagerService.loadAudit();
const byId = new Map(audit.roles.map((r) => [r.id, r]));
const nm = (id: string) => byId.get(id)?.name ?? id;

// ── Proposed top → bottom hierarchy (role IDs) ────────────────────────
const ORDER: string[] = [
  // 👑 ownership
  '1534981491140988968', '1534981506747994132', '1534981494018281492',
  // 🤖 high-trust bots (managed): admin bots high; LGCY Core below ownership,
  // above all it manages; Ticket Tool above Ticket Support
  '1534981173581975736', '1545535769588793397', '1534983385221562630', '1551612525336858747', '1535007958159851653',
  // ⚙️ management
  '1534981503631622235', '1534981496912351474', '1534981510032134285',
  // 🛡️ staff
  '1534981553992765731', '1534981563127697501',
  // 💎 status
  '1534981500200816830', '1534981513160949991', '1534981516176654446', '1534981519041499196', '1534981522053140500', '1534981525001605371', '1534981527774036209', '1534981530613710959', '1534981533813837884', '1534981537844564070', '1534981541296603438', '1534981544282820628', '1534981548091375666',
  // 👤 community
  '1534981551052296202',
  // 💰 economy
  '1534981604429267096', '1534981608807989318', '1534981611462856787',
  // 🔒 special
  '1534981557025243318', '1534981560275828917',
  // 🎮 game
  '1534981598351724634', '1534981594081792173', '1534981581809127578', '1534981591250505749', '1534981585516888205',
  // ⚠️ moderation
  '1534981566688919573', '1534981569805025371', '1534981572975919208', '1534981576637677859', '1534981601551974662',
  // ❓ other
  '1534981614835339265',
];

const N = ORDER.length; // 43
console.log('\n════════ 3A · HIERARCHY MOVE DIFF ════════');
let moves = 0;
ORDER.forEach((id, i) => {
  const target = N - i; // top of list = highest position
  const cur = byId.get(id)?.position ?? -1;
  const managed = byId.get(id)?.managed ? ' [managed]' : '';
  if (cur !== target) { moves++; console.log(`  MOVE ${nm(id).padEnd(22)} ${String(cur).padStart(2)} → ${String(target).padStart(2)}${managed}`); }
});
console.log(`  ── MOVE operations: ${moves}`);

// ── Proposed role-permission changes (3B) ─────────────────────────────
const STATUS = new Set(['1534981500200816830', '1534981513160949991', '1534981516176654446', '1534981519041499196', '1534981522053140500', '1534981525001605371', '1534981527774036209', '1534981530613710959', '1534981533813837884', '1534981537844564070', '1534981541296603438', '1534981544282820628', '1534981548091375666']);
const GAME_BOTS = new Set(['1534981598351724634', '1534981594081792173', '1534981581809127578', '1534981591250505749', '1534981585516888205', '1534981560275828917']);
const STATUS_STRIP = ['ModerateMembers', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageNicknames', 'ViewAuditLog', 'ManageMessages', 'MentionEveryone'];
const SPECIFIC: Record<string, { remove?: string[]; add?: string[] }> = {
  '1534981496912351474': { remove: ['Administrator'], add: ['ManageChannels', 'ManageGuild', 'ViewAuditLog', 'ManageRoles'] }, // Developer
  '1534981503631622235': { remove: ['ManageWebhooks', 'ManageGuildExpressions', 'ManageEmojisAndStickers', 'CreateGuildExpressions'] }, // Head Manager
  '1534981510032134285': { remove: ['ManageRoles', 'ManageWebhooks', 'ManageGuildExpressions', 'ManageEmojisAndStickers', 'CreateGuildExpressions'] }, // Consultant
  '1534981506747994132': { remove: ['ManageGuildExpressions', 'CreateGuildExpressions', 'ManageEmojisAndStickers', 'MentionEveryone'] }, // Co-Owner
};

console.log('\n════════ 3B · ROLE-PERMISSION DIFF ════════');
let permOps = 0, rolesTouched = 0;
for (const r of audit.roles) {
  if (r.isEveryone || r.managed) continue; // managed bot perms can't be edited via role
  const have = new Set(r.permissions);
  let remove: string[] = [];
  let add: string[] = [];
  if (SPECIFIC[r.id]) { remove = (SPECIFIC[r.id]!.remove ?? []); add = (SPECIFIC[r.id]!.add ?? []); }
  else if (STATUS.has(r.id)) remove = STATUS_STRIP;
  else if (GAME_BOTS.has(r.id)) remove = ['MentionEveryone'];
  const rem = remove.filter((p) => have.has(p));
  const ad = add.filter((p) => !have.has(p));
  if (rem.length || ad.length) {
    rolesTouched++; permOps += rem.length + ad.length;
    console.log(`  ${r.name}`);
    rem.forEach((p) => console.log(`      − ${p}`));
    ad.forEach((p) => console.log(`      + ${p}`));
  }
}
console.log(`  ── permission operations: ${permOps} across ${rolesTouched} roles (managed bot roles excluded — not editable)`);

console.log('\n(3C channel-permission diff requires a channel overwrite capture — run `npm run audit:channels`.)\n');
