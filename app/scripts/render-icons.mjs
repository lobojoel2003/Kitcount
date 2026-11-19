#!/usr/bin/env node
// Renders the app icons, adaptive icons, splash and favicon from the logo
// geometry with headless Chromium (Playwright). Run after changing the logo:
//   node scripts/render-icons.mjs
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');

const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14B8A6"/><stop offset="1" stop-color="#0F766E"/></linearGradient></defs>`;
const mark = (stroke = '#0F766E', fill = '#FFFFFF') => `
  <rect x="30" y="34" width="68" height="64" rx="12" fill="${fill}" opacity="0.18"/>
  <path d="M44 30h40a6 6 0 0 1 6 6v6H38v-6a6 6 0 0 1 6-6z" fill="${fill}" opacity="0.9"/>
  <rect x="30" y="42" width="68" height="56" rx="12" fill="${fill}"/>
  <path d="M46 71l11 11 24-26" fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`;

const svgs = {
  // iOS/Android legacy icon: full-bleed square (the OS applies its own mask).
  'icon.png': [
    1024,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${grad}<rect width="128" height="128" fill="url(#g)"/>${mark()}</svg>`,
  ],
  // Android adaptive icon: the foreground must sit inside the central 66% safe zone.
  'android-icon-foreground.png': [512, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 -32 192 192">${mark()}</svg>`],
  'android-icon-background.png': [
    512,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${grad}<rect width="128" height="128" fill="url(#g)"/></svg>`,
  ],
  // Themed (monochrome) icon: only alpha matters, so the check is cut out with a mask.
  'android-icon-monochrome.png': [
    432,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-32 -32 192 192"><defs><mask id="m"><rect x="-32" y="-32" width="192" height="192" fill="#fff"/><path d="M46 71l11 11 24-26" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><g mask="url(#m)" fill="#000"><path d="M44 30h40a6 6 0 0 1 6 6v6H38v-6a6 6 0 0 1 6-6z" opacity="0.9"/><rect x="30" y="42" width="68" height="56" rx="12"/></g></svg>`,
  ],
  'splash-icon.png': [
    1024,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${grad}<rect x="4" y="4" width="120" height="120" rx="30" fill="url(#g)"/>${mark()}</svg>`,
  ],
  'favicon.png': [
    48,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${grad}<rect x="4" y="4" width="120" height="120" rx="30" fill="url(#g)"/>${mark()}</svg>`,
  ],
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, [size, svg]] of Object.entries(svgs)) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: join(assets, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('wrote', file);
}
await browser.close();
