import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { loopbackOnly, csrfGuard, errorHandler } from './security.js';
import { apiRouter } from './api/routes.js';

const here = dirname(fileURLToPath(import.meta.url));
const UI_DIR = resolve(here, '..', 'ui');

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');

  // Local-only. Body limit is generous enough for base64 background uploads.
  app.use(loopbackOnly);
  app.use(express.json({ limit: '10mb' }));

  // API (CSRF/origin-guarded for mutations).
  app.use('/api', csrfGuard, apiRouter());

  // Static UI.
  app.use(express.static(UI_DIR, { index: 'index.html', extensions: ['html'] }));

  // SPA fallback (hash routing, so just serve index for unknown non-API GETs).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(resolve(UI_DIR, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}
