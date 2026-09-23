import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Secure, OS-appropriate secret storage for the bot token.
 *
 * WHERE: a per-user data directory OUTSIDE the git repo
 *   - Windows: %APPDATA%\lgcy-core   (override with LGCY_DATA_DIR)
 *   - other:   ~/.lgcy-core
 *
 * HOW:
 *   - A 256-bit machine-local key is generated once (`secret.key`).
 *   - On Windows the key is wrapped with DPAPI (CurrentUser) — this is the
 *     expected, default secure provider. If DPAPI is unavailable we DO NOT
 *     silently fall back: writing a secret is blocked until the developer
 *     explicitly opts in (LGCY_ALLOW_INSECURE_SECRETS=1), which enables an
 *     encrypted key-file fallback and surfaces a security warning.
 *   - On non-Windows, the encrypted key file (AES-256-GCM) is the normal secure
 *     provider.
 *   - The token itself is AES-256-GCM encrypted under the key in `secrets.json`.
 *
 * The plaintext token is returned ONLY by getToken() (bot login). It is never
 * placed in API responses, logs, diagnostics, exports, or errors — and neither
 * is the key, the encrypted blob, or the storage path.
 */

export type SecretProvider = 'dpapi' | 'aes-256-gcm' | 'unavailable';

export interface ProviderInfo {
  platform: NodeJS.Platform;
  provider: SecretProvider;
  /** True when the active provider meets the platform's secure baseline. */
  secure: boolean;
  /** Short label for the UI, e.g. "Windows DPAPI". */
  label: string;
  /** Security status word for the UI: SECURE | INSECURE | BLOCKED. */
  status: 'SECURE' | 'INSECURE' | 'BLOCKED';
  warning?: string;
  optIn: { available: boolean; enabled: boolean };
}

interface SecretsFile {
  token?: { iv: string; tag: string; ciphertext: string };
  updatedAt?: string;
}

function optInEnabled(): boolean {
  return process.env.LGCY_ALLOW_INSECURE_SECRETS === '1';
}

function dataDir(): string {
  const override = process.env.LGCY_DATA_DIR;
  const base = override ?? (process.platform === 'win32' && process.env.APPDATA
    ? join(process.env.APPDATA, 'lgcy-core')
    : join(homedir(), '.lgcy-core'));
  mkdirSync(base, { recursive: true });
  return base;
}
const keyPath = () => join(dataDir(), 'secret.key');
const secretsPath = () => join(dataDir(), 'secrets.json');

// ── DPAPI (Windows) ───────────────────────────────────────────────────
function dpapi(mode: 'protect' | 'unprotect', b64: string): string | null {
  if (process.platform !== 'win32') return null;
  const verb = mode === 'protect' ? 'Protect' : 'Unprotect';
  const script = `Add-Type -AssemblyName System.Security;` +
    `$in=[Console]::In.ReadToEnd().Trim();` +
    `$b=[Convert]::FromBase64String($in);` +
    `$o=[Security.Cryptography.ProtectedData]::${verb}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);` +
    `[Convert]::ToBase64String($o)`;
  try {
    const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      input: b64, encoding: 'utf8', timeout: 10000,
    });
    if (res.status === 0 && res.stdout) return res.stdout.trim();
  } catch { /* unavailable */ }
  return null;
}

let dpapiProbe: boolean | null = null;
function dpapiAvailable(): boolean {
  if (process.platform !== 'win32') return false;
  if (dpapiProbe !== null) return dpapiProbe;
  const probe = Buffer.from('lgcy-dpapi-probe').toString('base64');
  const enc = dpapi('protect', probe);
  dpapiProbe = !!enc && dpapi('unprotect', enc) === probe;
  return dpapiProbe;
}

/** Describes the active/expected provider — safe to show in the UI. */
export function providerInfo(): ProviderInfo {
  const platform = process.platform;
  const optIn = { available: platform === 'win32', enabled: optInEnabled() };

  // If a key already exists, its prefix determines the active provider.
  let existing: 'dpapi' | 'raw' | null = null;
  if (existsSync(keyPath())) existing = readFileSync(keyPath(), 'utf8').startsWith('dpapi:') ? 'dpapi' : 'raw';

  if (platform === 'win32') {
    const dpapiOk = existing === 'dpapi' || (existing === null && dpapiAvailable());
    if (dpapiOk && existing !== 'raw') {
      return { platform, provider: 'dpapi', secure: true, label: 'Windows DPAPI', status: 'SECURE', optIn };
    }
    // DPAPI not in use (unavailable, or an existing raw key on Windows).
    if (optIn.enabled) {
      return {
        platform, provider: 'aes-256-gcm', secure: false, label: 'Encrypted key file (fallback)', status: 'INSECURE',
        warning: 'Windows DPAPI is not the active provider. Using the encrypted key-file fallback (explicitly opted in). This key is not OS-bound.',
        optIn,
      };
    }
    return {
      platform, provider: 'unavailable', secure: false, label: 'DPAPI unavailable', status: 'BLOCKED',
      warning: 'Windows DPAPI could not be initialized. Secret storage is blocked. Fix DPAPI, or set LGCY_ALLOW_INSECURE_SECRETS=1 to explicitly allow the encrypted key-file fallback.',
      optIn,
    };
  }
  // Non-Windows: the encrypted key file is the normal secure provider.
  return { platform, provider: 'aes-256-gcm', secure: true, label: 'Encrypted key file (AES-256-GCM)', status: 'SECURE', optIn };
}

// ── key management ────────────────────────────────────────────────────
let cachedKey: Buffer | null = null;
function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const path = keyPath();

  if (existsSync(path)) {
    const stored = readFileSync(path, 'utf8').trim();
    if (stored.startsWith('dpapi:')) {
      const unwrapped = dpapi('unprotect', stored.slice(6));
      if (!unwrapped) throw new Error('Unable to unwrap the secret key with DPAPI (different Windows user or machine). No fallback is used.');
      cachedKey = Buffer.from(unwrapped, 'base64');
      return cachedKey;
    }
    cachedKey = Buffer.from(stored.replace(/^raw:/, ''), 'base64');
    return cachedKey;
  }

  // First run — decide the provider explicitly (no silent fallback on Windows).
  const key = randomBytes(32);
  const b64 = key.toString('base64');
  if (process.platform === 'win32') {
    if (dpapiAvailable()) {
      writeFileSync(path, `dpapi:${dpapi('protect', b64)}`, { mode: 0o600 });
    } else if (optInEnabled()) {
      writeFileSync(path, `raw:${b64}`, { mode: 0o600 });
    } else {
      throw new Error('Windows DPAPI is unavailable and the insecure fallback is not opted in (set LGCY_ALLOW_INSECURE_SECRETS=1).');
    }
  } else {
    writeFileSync(path, `raw:${b64}`, { mode: 0o600 });
  }
  try { chmodSync(path, 0o600); } catch { /* windows ignores */ }
  cachedKey = key;
  return key;
}

function readSecrets(): SecretsFile {
  const p = secretsPath();
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')) as SecretsFile; } catch { return {}; }
}
function writeSecrets(s: SecretsFile): void {
  writeFileSync(secretsPath(), JSON.stringify(s, null, 2), { mode: 0o600 });
}

export const secretStore = {
  providerInfo,

  setToken(token: string): void {
    if (!token || token.trim().length < 20) throw new Error('Token looks invalid (too short).');
    const info = providerInfo();
    if (!info.secure && !info.optIn.enabled) {
      throw new Error(info.warning ?? 'Secret storage is not secure; refusing to store the token.');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
    const ct = Buffer.concat([cipher.update(token.trim(), 'utf8'), cipher.final()]);
    writeSecrets({
      token: { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ct.toString('base64') },
      updatedAt: new Date().toISOString(),
    });
  },

  hasToken(): boolean {
    return !!readSecrets().token;
  },

  /** Plaintext token — ONLY for the bot at login. Never expose via API. */
  getToken(): string | null {
    const s = readSecrets();
    if (!s.token) return null;
    const decipher = createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(s.token.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(s.token.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(s.token.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  },

  clearToken(): void {
    const s = readSecrets();
    delete s.token; delete s.updatedAt;
    writeSecrets(s);
  },

  /** Frontend-safe metadata — provider status + whether a token exists. Never
   * the token, key, blob, or storage path. */
  meta(): { hasToken: boolean; updatedAt: string | null; provider: ProviderInfo } {
    const s = readSecrets();
    return { hasToken: !!s.token, updatedAt: s.updatedAt ?? null, provider: providerInfo() };
  },
};
