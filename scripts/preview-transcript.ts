/**
 * Renders a sample ticket transcript to /preview so the HTML output can be
 * reviewed without connecting to Discord. Run: `npm run preview:transcript`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderTranscriptHtml } from '../src/modules/tickets/transcript.js';

mkdirSync(resolve(process.cwd(), 'preview'), { recursive: true });
const html = renderTranscriptHtml(
  {
    ticketNumber: 42,
    category: 'General Support',
    subject: 'Cannot connect to FiveM server',
    openerId: 'GhostPlayer (123456789)',
    guildName: 'LGCY',
    createdAt: '2026-09-21 14:02:11',
    closedAt: '2026-09-21 14:19:44',
    closedBy: 'ModeratorNova (987654321)',
  },
  [
    { authorTag: 'GhostPlayer', authorId: '1', authorBot: false, timestampIso: '2026-09-21T14:02:12Z', content: "Hey, I can't connect to the FiveM server — it says handshake failed.", attachments: [{ name: 'error-screenshot.png', url: 'https://cdn.discordapp.com/attachments/x/error-screenshot.png' }], embedCount: 0 },
    { authorTag: 'LGCY Bot', authorId: '2', authorBot: true, timestampIso: '2026-09-21T14:02:13Z', content: 'A member of the LGCY team will be with you shortly.', attachments: [], embedCount: 1 },
    { authorTag: 'ModeratorNova', authorId: '3', authorBot: false, timestampIso: '2026-09-21T14:05:40Z', content: 'Hi Ghost! Clear your FiveM cache and reconnect. <this should fix it>', attachments: [], embedCount: 0 },
    { authorTag: 'GhostPlayer', authorId: '1', authorBot: false, timestampIso: '2026-09-21T14:18:02Z', content: 'That worked! Thank you 🙏', attachments: [], embedCount: 0 },
  ],
);
const out = resolve(process.cwd(), 'preview', 'sample-transcript.html');
writeFileSync(out, html);
// eslint-disable-next-line no-console
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB)`);
