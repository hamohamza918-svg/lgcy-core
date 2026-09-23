import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { redactString } from '../../src/services/redact.js';
import { scopedLogger } from '../../src/utils/logger.js';

const log = scopedLogger('control-center');

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.CONTROL_PORT ?? 3030);

/** Per-process CSRF token, handed to the UI and required on mutating requests. */
export const CSRF_TOKEN = randomBytes(24).toString('hex');

const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);

/** Rejects any request that didn't originate from the local loopback interface. */
export function loopbackOnly(req: Request, res: Response, next: NextFunction): void {
  const ip = req.socket.remoteAddress ?? '';
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    next();
    return;
  }
  res.status(403).json({ error: 'Control Center is local-only.' });
}

/**
 * For state-changing requests, require a same-origin Origin header AND the CSRF
 * token. GET/HEAD are read-only and skipped.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  const origin = req.get('origin');
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.status(403).json({ error: 'Cross-origin request blocked.' });
    return;
  }
  const token = req.get('x-lgcy-csrf');
  if (token !== CSRF_TOKEN) {
    res.status(403).json({ error: 'Invalid or missing CSRF token.' });
    return;
  }
  next();
}

/** Async route wrapper that funnels errors to the error handler. */
export function asyncRoute(
  fn: (req: Request, res: Response) => unknown,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/**
 * Terminal error handler: logs the redacted error server-side and returns a
 * safe, redacted message to the browser — never a stack trace or a secret.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = err instanceof Error ? err.message : 'Unexpected error';
  const status = (err as { statusCode?: number })?.statusCode ?? 400;
  const safe = redactString(message);
  log.error({ err: safe, status }, 'control-center request error');
  if (!res.headersSent) res.status(status).json({ error: safe });
}

export { log as controlLog };
