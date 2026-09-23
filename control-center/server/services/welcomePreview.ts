import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateWelcomeCard } from '../../../src/modules/welcome/card.js';
import type { GuildConfig } from '../../../src/config/guildConfig.js';

let sampleAvatarPath: string | null = null;

/** Generates (once) a sample avatar so the preview shows an image, not just a badge. */
function ensureSampleAvatar(): string {
  const path = join(tmpdir(), 'lgcy-sample-avatar.png');
  if (sampleAvatarPath && existsSync(path)) return path;
  const size = 256;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#2b8cff');
  g.addColorStop(1, '#7b5cff');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 140px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('G', size / 2, size / 2 + 8);
  writeFileSync(path, c.toBuffer('image/png'));
  sampleAvatarPath = path;
  return path;
}

/** Renders a live welcome-card preview from a (draft) config. */
export async function renderWelcomePreview(cfg: GuildConfig, memberNumber: number): Promise<Buffer> {
  const primaryHex = cfg.colors.primary
    ? `#${cfg.colors.primary.toString(16).padStart(6, '0')}`
    : undefined;
  return generateWelcomeCard({
    username: 'GhostPlayer',
    avatarSource: ensureSampleAvatar(),
    memberNumber,
    title: cfg.welcome.title,
    primaryHex,
    backgroundSource: cfg.welcomeBackground,
  });
}
