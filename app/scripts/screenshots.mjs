#!/usr/bin/env node
// Captures README screenshots from the exported web demo (synthetic data only).
//
//   npm run export:web && node scripts/screenshots.mjs
//
// Writes docs/images/screens/*.png and docs/images/hero.png.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(here, '..', '..', 'docs', 'images');
// --out DIR writes screenshots elsewhere (CI smoke test); --no-hero skips the banner.
const outArg = process.argv.indexOf('--out');
const outDir = outArg > 0 ? process.argv[outArg + 1] : join(imagesDir, 'screens');
const withHero = !process.argv.includes('--no-hero');
mkdirSync(outDir, { recursive: true });
let failures = 0;

const PORT = 8091;
const server = spawn(process.execPath, [join(here, 'serve-dist.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const url = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch();

async function session(colorScheme) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme });
  page.on('pageerror', (e) => {
    failures++;
    console.error('page error:', e.message);
  });
  await page.goto(url);
  await page.getByTestId('start-demo').waitFor();
  return page;
}

const scrollTop = (page) =>
  page.evaluate(() => {
    for (const el of document.querySelectorAll('div')) if (el.scrollTop > 0) el.scrollTop = 0;
  });

const shot = async (page, name) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `${name}.png`) });
  console.log('captured', name);
};

const tab = (page, name) => page.getByRole('tab', { name }).or(page.getByRole('link', { name })).first().click();

try {
  // Light mode tour.
  const page = await session('light');
  await shot(page, 'welcome');
  await page.getByTestId('start-demo').click();
  await page.getByTestId('code-input').waitFor();
  await page.getByTestId('code-input').fill('JD03');
  for (const id of ['syringes', 'syringes', 'syringes', 'naloxone_nasal', 'fentanyl_strips', 'cookers', 'cottons', 'alcohol_pads']) {
    await page.getByTestId(`tile-${id}`).click();
  }
  await page.getByRole('button', { name: 'Add 10 Syringes in' }).click();
  await page.getByRole('button', { name: 'Add 10 Syringes in' }).click();
  await page.getByRole('button', { name: 'Increase Syringes in' }).click();
  await scrollTop(page);
  await shot(page, 'log-visit');

  await tab(page, 'Inventory');
  await page.getByText('Whole program').waitFor();
  await shot(page, 'inventory');

  await tab(page, 'Reports');
  await page.getByTestId('share-pdf').waitFor();
  await shot(page, 'reports');

  await tab(page, 'Settings');
  await page.getByText('Panic wipe').first().waitFor();
  await shot(page, 'settings');

  await page.getByText('Lock now').click();
  await page.getByText('Kitcount is locked').waitFor();
  await shot(page, 'lock');

  // Smoke: wrong PIN, right PIN, log a visit, panic wipe.
  const typePin = async (pin) => {
    for (const d of pin) await page.getByRole('button', { name: d, exact: true }).click();
  };
  await typePin('111111');
  await page.waitForTimeout(400);
  await typePin('246810');
  await page.getByTestId('code-input').waitFor();
  await page.getByTestId('code-input').fill('ZZ99');
  await page.getByTestId('tile-syringes').click();
  await page.getByTestId('done').click();
  await page.getByText('Visit saved · new participant').waitFor();
  await tab(page, 'Settings');
  const hold = page.getByText('Panic wipe — hold 3 seconds');
  await hold.scrollIntoViewIfNeeded();
  const box = await hold.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(3600);
  await page.mouse.up();
  await page.getByText('Device wiped').waitFor();
  console.log('smoke: unlock, log visit and panic wipe OK');
  await page.close();

  // Dark mode log screen.
  const dark = await session('dark');
  await dark.getByTestId('start-demo').click();
  await dark.getByTestId('code-input').waitFor();
  await dark.getByTestId('code-input').fill('MR11');
  for (const id of ['syringes', 'syringes', 'naloxone_nasal', 'naloxone_nasal', 'xylazine_strips', 'sterile_water'])
    await dark.getByTestId(`tile-${id}`).click();
  await shot(dark, 'log-visit-dark');
  await dark.close();

  if (!withHero) throw Object.assign(new Error('skip hero'), { skip: true });
  // Hero banner composed from the screenshots.
  const img = (name) => `data:image/png;base64,${readFileSync(join(outDir, `${name}.png`)).toString('base64')}`;
  const logo = readFileSync(join(imagesDir, 'logo.svg'), 'utf8');
  const phone = (name, extra = '') => `<div class="phone ${extra}"><img src="${img(name)}"/></div>`;
  const hero = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await hero.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    body { margin: 0; width: 1600px; height: 900px; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: radial-gradient(1200px 700px at 15% 20%, #134e48 0%, #0b2f2b 45%, #07201d 100%); color: #e9f3f1; overflow: hidden; position: relative; }
    .copy { position: absolute; left: 80px; top: 150px; width: 540px; }
    .brand { display: flex; align-items: center; gap: 22px; }
    .brand svg { width: 96px; height: 96px; }
    h1 { font-size: 88px; letter-spacing: -3px; margin: 0; font-weight: 900; }
    p.tag { font-size: 31px; line-height: 1.28; color: #b9d8d2; margin: 34px 0 34px; font-weight: 600; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 16px; }
    li { font-size: 23px; color: #d9ece8; display: flex; gap: 14px; align-items: center; font-weight: 600; }
    li b { display: inline-flex; width: 34px; height: 34px; border-radius: 10px; background: #2bb5a6; color: #04201c; align-items: center; justify-content: center; font-size: 20px; }
    .phones { position: absolute; left: 700px; top: 80px; width: 860px; height: 800px; }
    .phone { position: absolute; width: 300px; height: 649px; border-radius: 52px; background: #0d1715; padding: 12px;
      box-shadow: 0 40px 90px rgba(0,0,0,.55), inset 0 0 0 2px #2c3d39; }
    .phone img { width: 100%; height: 100%; border-radius: 30px; display: block; object-fit: cover; object-position: top; }
    .p1 { left: 10px; top: 70px; transform: rotate(-6deg); }
    .p2 { left: 280px; top: 0; z-index: 2; }
    .p3 { left: 550px; top: 70px; transform: rotate(6deg); }
  </style></head><body>
    <div class="copy">
      <div class="brand">${logo}<h1>Kitcount</h1></div>
      <p class="tag">Fast, private visit logging and one-button state reports for syringe services programs.</p>
      <ul>
        <li><b>✓</b> A visit in about 15 seconds, one-handed</li>
        <li><b>✓</b> Works fully offline · end-to-end encrypted sync</li>
        <li><b>✓</b> No names · hashed codes · panic wipe</li>
        <li><b>✓</b> Inventory with naloxone low-stock warnings</li>
      </ul>
    </div>
    <div class="phones">
      ${phone('inventory', 'p1')}
      ${phone('log-visit', 'p2')}
      ${phone('reports', 'p3')}
    </div>
  </body></html>`);
  await hero.waitForTimeout(300);
  await hero.screenshot({ path: join(imagesDir, 'hero.png') });
  console.log('captured hero');
} catch (e) {
  if (!e.skip) {
    failures++;
    console.error(e);
  }
} finally {
  await browser.close();
  server.kill();
}
process.exit(failures > 0 ? 1 : 0);
