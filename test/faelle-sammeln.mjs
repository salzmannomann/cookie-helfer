// Sammelt Cookie-Banner (Text + Knöpfe) von den Seiten aus messung/seiten.json für die KI-Messung.
// Die Erweiterung ist dabei ausgeschaltet, damit das Banner stehen bleibt.
// Aufruf: node test/faelle-sammeln.mjs  → test/ki-faelle-roh.json (danach von Hand beschriften → extension/ki-faelle.json)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension');
const seiten = JSON.parse(fs.readFileSync(path.join(root, 'messung', 'seiten.json'), 'utf8'));
const executablePath =
  process.env.CHROME_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const faelle = [];
async function sammle(seite) {
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-sammeln-'));
  const ctx = await chromium.launchPersistentContext(profil, {
    executablePath,
    headless: true,
    locale: 'de-AT',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-blink-features=AutomationControlled'],
  });
  try {
    const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));
    await new Promise((r) => setTimeout(r, 500));
    await sw.evaluate(() => chrome.storage.local.set({ prefs: { aktiv: false } }));
    const page = await ctx.newPage();
    await page.goto(seite.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(9000);
    const banner = await sw.evaluate(async () => {
      const tab = (await chrome.tabs.query({})).find((t) => /^https?:/.test(t.url || ''));
      return chrome.tabs.sendMessage(tab.id, { type: 'ch:bannerLesen' }, { frameId: 0 }).catch(() => null);
    });
    const name = new URL(seite.url).hostname.replace(/^www\./, '') + new URL(seite.url).pathname.replace(/\/$/, '');
    if (banner?.knoepfe?.length) faelle.push({ seite: name, ...banner });
    console.log(`${name.padEnd(28)} ${banner?.knoepfe?.length ? banner.knoepfe.map((k) => k.text).join(' | ').slice(0, 110) : '–'}`);
  } catch (e) {
    console.log(`${seite.url} Fehler: ${String(e.message).split('\n')[0]}`);
  } finally {
    await ctx.close().catch(() => {});
    fs.rmSync(profil, { recursive: true, force: true });
  }
}

let i = 0;
await Promise.all(Array.from({ length: 3 }, async () => { while (i < seiten.length) await sammle(seiten[i++]); }));
fs.writeFileSync(path.join(root, 'test', 'ki-faelle-roh.json'), JSON.stringify(faelle, null, 2));
console.log(`\n${faelle.length} Banner gesammelt`);
