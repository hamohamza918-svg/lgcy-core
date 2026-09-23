import {
  createCanvas,
  loadImage,
  GlobalFonts,
  type SKRSContext2D,
  type Image,
} from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { scopedLogger } from '../../utils/logger.js';

const log = scopedLogger('welcome-card');

const WIDTH = 1000;
const HEIGHT = 400;

// Register a couple of Windows system fonts by path so text renders reliably on
// Windows dev boxes. Falls back to whatever @napi-rs/canvas resolves otherwise.
let FONT_BOLD = 'sans-serif';
let FONT_REGULAR = 'sans-serif';
(() => {
  const candidates: { path: string; family: string; assignBold?: boolean }[] = [
    { path: 'C:/Windows/Fonts/segoeuib.ttf', family: 'Segoe UI Semibold', assignBold: true },
    { path: 'C:/Windows/Fonts/segoeui.ttf', family: 'Segoe UI' },
    { path: 'C:/Windows/Fonts/arialbd.ttf', family: 'Arial Bold', assignBold: true },
    { path: 'C:/Windows/Fonts/arial.ttf', family: 'Arial' },
  ];
  for (const c of candidates) {
    if (existsSync(c.path)) {
      try {
        GlobalFonts.registerFromPath(c.path, c.family);
        if (c.assignBold && FONT_BOLD === 'sans-serif') FONT_BOLD = c.family;
        if (!c.assignBold && FONT_REGULAR === 'sans-serif') FONT_REGULAR = c.family;
      } catch {
        /* ignore individual font failures */
      }
    }
  }
  if (FONT_BOLD === 'sans-serif' && FONT_REGULAR !== 'sans-serif') FONT_BOLD = FONT_REGULAR;
  if (FONT_REGULAR === 'sans-serif' && FONT_BOLD !== 'sans-serif') FONT_REGULAR = FONT_BOLD;
})();

export interface WelcomeCardOptions {
  username: string;
  /** URL or local path to the member's avatar. Falls back to an initial badge. */
  avatarSource?: string;
  memberNumber?: number;
  title?: string;
  /** Hex string for the primary electric-blue, e.g. "#2b8cff". */
  primaryHex?: string;
  accentHex?: string;
  /** Optional custom background image (URL or local path). */
  backgroundSource?: string;
}

/** Rounded rectangle path helper. */
function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function tryLoad(source?: string): Promise<Image | null> {
  if (!source) return null;
  try {
    return await loadImage(source);
  } catch (err) {
    log.debug({ err, source }, 'image load failed — using fallback');
    return null;
  }
}

/**
 * Renders the LGCY welcome card as a PNG buffer.
 *
 * Style: fun, energetic community/gaming vibe — electric blue, subtle glows and
 * light streaks, clean and modern (bright, not dark-corporate).
 */
export async function generateWelcomeCard(
  opts: WelcomeCardOptions,
): Promise<Buffer> {
  const primary = opts.primaryHex ?? '#2b8cff';
  const accent = opts.accentHex ?? '#4fd2ff';
  const title = opts.title ?? 'WELCOME TO LGCY';

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // ── Background ────────────────────────────────────────────────
  const bg = await tryLoad(opts.backgroundSource);
  if (bg) {
    // cover-fit the custom background
    const scale = Math.max(WIDTH / bg.width, HEIGHT / bg.height);
    const bw = bg.width * scale;
    const bh = bg.height * scale;
    ctx.drawImage(bg, (WIDTH - bw) / 2, (HEIGHT - bh) / 2, bw, bh);
    // lightly darken so overlaid text stays legible without hiding the art
    ctx.fillStyle = 'rgba(6, 16, 42, 0.30)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else {
    const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    grad.addColorStop(0, '#0a1a3f');
    grad.addColorStop(0.55, '#123a8a');
    grad.addColorStop(1, '#0d2f7a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
  const hasBg = Boolean(bg);

  // Decorations that only make sense on the plain generated card — a custom
  // artwork background brings its own branding, glows, and framing.
  if (!hasBg) {
    // ── Energetic glows ─────────────────────────────────────────
    const glow = (x: number, y: number, r: number, color: string, alpha: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, hexToRgba(color, alpha));
      g.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    };
    glow(160, 120, 320, accent, 0.35);
    glow(880, 320, 380, primary, 0.4);

    // ── Diagonal light streaks (subtle gaming vibe) ─────────────
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 40;
    for (let i = -2; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 160 - 100, HEIGHT + 50);
      ctx.lineTo(i * 160 + 220, -50);
      ctx.stroke();
    }
    ctx.restore();

    // ── Inner rounded panel + glowing border ────────────────────
    ctx.save();
    ctx.shadowColor = hexToRgba(accent, 0.9);
    ctx.shadowBlur = 24;
    ctx.strokeStyle = hexToRgba(accent, 0.85);
    ctx.lineWidth = 3;
    roundRect(ctx, 16, 16, WIDTH - 32, HEIGHT - 32, 28);
    ctx.stroke();
    ctx.restore();

    // ── LGCY wordmark (top-left branding) ───────────────────────
    ctx.save();
    ctx.font = `28px "${FONT_BOLD}"`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = hexToRgba(accent, 1);
    ctx.shadowBlur = 18;
    ctx.fillText('LGCY', 48, 62);
    ctx.restore();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(48 + measure(ctx, 'LGCY', `28px "${FONT_BOLD}"`) + 12, 54, 5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Left-anchored legibility scrim: darker on the left for the text, fading
    // out by ~72% width so the artwork's logo, crown and mascot stay visible.
    const scrim = ctx.createLinearGradient(0, 0, WIDTH, 0);
    scrim.addColorStop(0, 'rgba(5, 12, 32, 0.85)');
    scrim.addColorStop(0.45, 'rgba(5, 12, 32, 0.6)');
    scrim.addColorStop(0.72, 'rgba(5, 12, 32, 0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // ── Avatar with glowing ring ──────────────────────────────────
  // Background mode nudges everything left so the artwork stays the hero.
  const avX = hasBg ? 148 : 175;
  const avY = hasBg ? 200 : 210;
  const avR = hasBg ? 80 : 92;

  // outer glow ring
  ctx.save();
  ctx.shadowColor = accent;
  ctx.shadowBlur = 30;
  ctx.lineWidth = 8;
  ctx.strokeStyle = accent;
  ctx.beginPath();
  ctx.arc(avX, avY, avR + 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // avatar image (clipped to circle) or fallback initial badge
  const avatar = await tryLoad(opts.avatarSource);
  ctx.save();
  ctx.beginPath();
  ctx.arc(avX, avY, avR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, avX - avR, avY - avR, avR * 2, avR * 2);
  } else {
    const ig = ctx.createLinearGradient(avX - avR, avY - avR, avX + avR, avY + avR);
    ig.addColorStop(0, primary);
    ig.addColorStop(1, accent);
    ctx.fillStyle = ig;
    ctx.fillRect(avX - avR, avY - avR, avR * 2, avR * 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `86px "${FONT_BOLD}"`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((opts.username[0] ?? '?').toUpperCase(), avX, avY + 4);
  }
  ctx.restore();

  // ── Text block ────────────────────────────────────────────────
  const textX = hasBg ? 262 : 320;
  const titleSize = hasBg ? 36 : 44;
  const nameSize = hasBg ? 32 : 40;
  const titleY = hasBg ? 168 : 150;
  const nameY = hasBg ? 210 : 215;
  const divY = hasBg ? 232 : 240;
  const memberY = hasBg ? 272 : 285;
  const taglineY = hasBg ? 302 : 325;
  const divRight = hasBg ? 648 : WIDTH - 60;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Title
  ctx.save();
  ctx.font = `${titleSize}px "${FONT_BOLD}"`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = hexToRgba(primary, 1);
  ctx.shadowBlur = 20;
  ctx.fillText(title, textX, titleY);
  ctx.restore();

  // Username (truncate if too long)
  const displayName = truncate(ctx, opts.username, `${nameSize}px "${FONT_BOLD}"`, divRight - textX);
  ctx.font = `${nameSize}px "${FONT_BOLD}"`;
  ctx.fillStyle = accent;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText(displayName, textX, nameY);
  ctx.restore();

  // Divider
  ctx.strokeStyle = hexToRgba('#ffffff', 0.25);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(textX, divY);
  ctx.lineTo(divRight, divY);
  ctx.stroke();

  // Member number
  if (opts.memberNumber && opts.memberNumber > 0) {
    ctx.font = `${hasBg ? 24 : 28}px "${FONT_REGULAR}"`;
    ctx.fillStyle = '#dbe9ff';
    ctx.fillText(`Member #${opts.memberNumber}`, textX, memberY);
  }

  // Tagline
  ctx.font = `${hasBg ? 19 : 22}px "${FONT_REGULAR}"`;
  ctx.fillStyle = hexToRgba('#ffffff', 0.72);
  ctx.fillText('More than a server — a community.', textX, taglineY);

  return canvas.toBuffer('image/png');
}

// ── helpers ──────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function measure(ctx: SKRSContext2D, text: string, font: string): number {
  const prev = ctx.font;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  ctx.font = prev;
  return w;
}

function truncate(
  ctx: SKRSContext2D,
  text: string,
  font: string,
  maxWidth: number,
): string {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '…';
}
