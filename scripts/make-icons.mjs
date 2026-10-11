// Erzeugt die Symbole (16/32/48/128 px) und icon.svg mit Chromium aus einer SVG-Vorlage
// (gleicher Aufbau wie bei Ruhepol: abgerundetes Quadrat mit Verlauf, schlichtes weißes Motiv).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');
fs.mkdirSync(out, { recursive: true });

// Cookie-Helfer: weißer Keks mit Biss, Verlauf Bernstein → Orange.
// Biss und Schokostücke sind ausgeschnitten (Maske), dadurch scheint der Verlauf durch.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#F5B342"/><stop offset="1" stop-color="#E5663A"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    <mask id="keks">
      <rect width="128" height="128" fill="#fff"/>
      <circle cx="92" cy="38" r="15" fill="#000"/>
      <circle cx="80" cy="56" r="10" fill="#000"/>
      <circle cx="49" cy="52" r="7" fill="#000"/>
      <circle cx="56" cy="82" r="7" fill="#000"/>
      <circle cx="82" cy="85" r="6" fill="#000"/>
    </mask>
  </defs>
  <rect x="4" y="4" width="120" height="120" rx="30" fill="url(#g)"/>
  <circle cx="64" cy="66" r="40" fill="#fff" opacity=".35" filter="url(#glow)" mask="url(#keks)"/>
  <circle cx="64" cy="66" r="36" fill="#fff" mask="url(#keks)"/>
</svg>`;

const executablePath =
  process.env.CHROME_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  fs.writeFileSync(path.join(out, `icon${size}.png`), await page.screenshot({ omitBackground: true }));
  console.log(`icon${size}.png`);
}
fs.writeFileSync(path.join(out, 'icon.svg'), svg);
await browser.close();
