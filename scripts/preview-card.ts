/**
 * Local welcome-card preview — renders sample LGCY welcome cards to /preview
 * WITHOUT connecting to Discord. Run: `npm run preview:card`.
 *
 * Optional args: `npm run preview:card -- "Username" 1337`
 */
import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateWelcomeCard } from '../src/modules/welcome/card.js';

const OUT_DIR = resolve(process.cwd(), 'preview');
mkdirSync(OUT_DIR, { recursive: true });

/** Generate a fun sample avatar (gradient + initial) so the preview has an
 * actual image in the avatar slot, no network required. */
function makeSampleAvatar(initial: string, from: string, to: string): string {
  const size = 256;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 140px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial.toUpperCase(), size / 2, size / 2 + 8);
  const path = resolve(OUT_DIR, `avatar-${initial.toLowerCase()}.png`);
  writeFileSync(path, c.toBuffer('image/png'));
  return path;
}

async function main(): Promise<void> {
  const argName = process.argv[2];
  const argNum = process.argv[3] ? Number(process.argv[3]) : undefined;

  const samples = argName
    ? [{ username: argName, memberNumber: argNum ?? 1, avatar: makeSampleAvatar(argName[0] ?? '?', '#2b8cff', '#4fd2ff'), file: 'welcome-custom.png' }]
    : [
        { username: 'GhostPlayer', memberNumber: 1337, avatar: makeSampleAvatar('G', '#2b8cff', '#7b5cff'), file: 'welcome-1.png' },
        { username: 'NovaKitten', memberNumber: 842, avatar: makeSampleAvatar('N', '#00d4ff', '#2b8cff'), file: 'welcome-2.png' },
        // fallback avatar path intentionally invalid → exercises the initial-badge fallback
        { username: 'xX_LongGamerTagThatOverflows_Xx', memberNumber: 5099, avatar: 'does-not-exist.png', file: 'welcome-3-fallback.png' },
      ];

  for (const s of samples) {
    const png = await generateWelcomeCard({
      username: s.username,
      avatarSource: s.avatar,
      memberNumber: s.memberNumber,
    });
    const out = resolve(OUT_DIR, s.file);
    writeFileSync(out, png);
    // eslint-disable-next-line no-console
    console.log(`✓ rendered ${s.file}  (${(png.length / 1024).toFixed(1)} KB)  → ${out}`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nAll previews written to: ${OUT_DIR}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('preview failed:', err);
  process.exit(1);
});
