import pino from 'pino';

// The logger reads its two settings straight from process.env with safe
// defaults, so it never depends on full (secret-requiring) env validation —
// tooling like the card preview can import modules that log without a token.
const level = process.env.LOG_LEVEL ?? 'info';
const isDev = (process.env.NODE_ENV ?? 'development') === 'development';

/**
 * Structured logger. In development it pretty-prints; in production it emits
 * JSON lines suitable for shipping to a log aggregator.
 */
export const logger = pino({
  level,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

/** Create a child logger tagged with a module/scope name. */
export function scopedLogger(scope: string) {
  return logger.child({ scope });
}
