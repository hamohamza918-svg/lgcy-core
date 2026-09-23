/**
 * Serializes every slash-command definition to JSON WITHOUT contacting Discord.
 * Used for backups and to review exactly what `deploy-commands` will register.
 * Run: `npm run dump:commands` (writes preview/command-defs.json).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODULES } from '../src/modules/index.js';

const defs = MODULES.flatMap((m) =>
  (m.commands ?? []).map((c) => ({ module: m.name, ...c.data.toJSON() })),
);

mkdirSync(resolve(process.cwd(), 'preview'), { recursive: true });
const out = resolve(process.cwd(), 'preview', 'command-defs.json');
writeFileSync(out, JSON.stringify(defs, null, 2));
// eslint-disable-next-line no-console
console.log(`wrote ${defs.length} command definitions → ${out}`);
