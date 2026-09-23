import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment schema. Secrets and deployment-level settings live here and ONLY
 * here — never scattered through the source. Anything guild-specific (channel
 * IDs, role IDs, colors, messages) belongs in the per-guild config in the DB,
 * not in env.
 */
const envSchema = z.object({
  // Credentials are OPTIONAL in env — the Control Center manages them (token in
  // the encrypted secret store, IDs in app_settings). env values, when present,
  // act as a fallback. Presence is enforced by the credentials service at the
  // moment a connection is actually attempted, not at process start.
  DISCORD_TOKEN: z.string().optional(),
  DISCORD_CLIENT_ID: z.string().optional(),
  GUILD_ID: z.string().optional(),
  COMMAND_SCOPE: z.enum(['guild', 'global']).default('guild'),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  DATABASE_PATH: z.string().default('data/lgcy-core.sqlite'),
  // Hosting: PORT triggers the keep-alive HTTP server (Render / UptimeRobot).
  PORT: z.string().optional(),
  // Config seeds — used to restore channel config on hosts with no persistent
  // disk (e.g. Render free), where the SQLite DB resets on every restart. Only
  // applied when the stored config doesn't already have the value.
  WELCOME_CHANNEL_ID: z.string().optional(),
  RULES_CHANNEL_ID: z.string().optional(),
  ROLES_CHANNEL_ID: z.string().optional(),
  // Log destinations per category (same purpose as above — restore on restart).
  LOG_MEMBER_CHANNEL_ID: z.string().optional(),
  LOG_MESSAGE_CHANNEL_ID: z.string().optional(),
  LOG_ROLE_CHANNEL_ID: z.string().optional(),
  LOG_VOICE_CHANNEL_ID: z.string().optional(),
  LOG_SERVER_CHANNEL_ID: z.string().optional(),
  LOG_MODERATION_CHANNEL_ID: z.string().optional(),
  // One-time bootstrap flag: grant the bot post-access overwrites on all
  // non-private channels (run once with Administrator, then remove).
  GRANT_CHANNELS: z.string().optional(),
  // One-time flag: post a sample embed to each configured log channel, then remove.
  LOG_TEST: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse & validate the environment. Throws a readable error listing every
 * missing/invalid variable rather than failing deep inside the client later.
 */
export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
