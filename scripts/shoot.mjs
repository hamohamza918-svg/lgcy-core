// Screenshots the running Control Center pages using the installed Edge browser
// via puppeteer-core (no browser download). Usage: node scripts/shoot.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://127.0.0.1:3030';
const OUT = 'preview/control-center';
mkdirSync(OUT, { recursive: true });

const pages = [
  ['wizard', '#/overview', 3000],       // wizard overlay appears on first load
  ['overview', '#/overview', 1200],
  ['bot', '#/bot', 1200],
  ['connection', '#/connection', 1400],
  ['modules', '#/modules', 1200],
  ['welcome', '#/welcome', 2200],       // wait for card image
  ['roles', '#/roles', 1400],
  ['tickets', '#/tickets', 1400],
  ['logging', '#/logging', 1200],
  ['diagnostics', '#/diagnostics', 2200],
  ['activity', '#/activity', 1400],
  ['settings', '#/settings', 1200],
  ['server', '#/server', 1400],
  ['database', '#/database', 1400],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,1100'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

for (const [name, hash, wait] of pages) {
  // For non-wizard shots, dismiss the wizard by exploring first.
  await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle2' });
  if (name !== 'wizard') {
    // click "Explore with sample data" if the wizard is present
    await sleep(600);
    await page.evaluate(() => {
      const b = document.getElementById('wz-explore');
      if (b) b.click();
    });
    await page.goto(BASE + '/' + hash, { waitUntil: 'networkidle2' });
  }
  await sleep(wait);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('shot', name);
}

await browser.close();
console.log('done');
