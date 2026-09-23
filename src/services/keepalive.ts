import { createServer } from 'node:http';
import { loadEnv } from '../config/env.js';
import { scopedLogger } from '../utils/logger.js';

const log = scopedLogger('keepalive');

/**
 * Minimal HTTP server for hosts that require a bound port (e.g. Render free Web
 * Services) and for uptime pingers (e.g. UptimeRobot) to hit so the service
 * doesn't idle-sleep. Only starts when PORT is set, so it's a no-op locally and
 * on a plain VM. Responds 200 on any path.
 */
export function startKeepAlive(): void {
  const { PORT } = loadEnv();
  if (!PORT) return;
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('LGCY Core is online');
  });
  server.on('error', (err) => log.error({ err }, 'keep-alive server error'));
  server.listen(Number(PORT), () => log.info({ port: PORT }, 'keep-alive HTTP server listening'));
}
