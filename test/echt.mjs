// Probelauf der echten Erweiterung auf echten Seiten (braucht Internet, nicht Teil von npm test).
// Aufruf:  npm run echt                 (alle Seiten aus messung/seiten.json)
//          npm run echt -- spiegel orf  (nur passende)
// Ergebnis: Status laut Erweiterung, TCF nach der Entscheidung, Screenshot in messung/ergebnisse/bilder/echt-*.jpg
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const extension = path.join(root, 'extension');
const bilder = path.join(root, 'messung', 'ergebnisse', 'bilder');
fs.mkdirSync(bilder, { recursive: true });

const filter = process.argv.slice(2);
let seiten = JSON.parse(fs.readFileSync(path.join(root, 'messung', 'seiten.json'), 'utf8'));
if (filter.length) seiten = seiten.filter((s) => filter.some((f) => s.url.includes(f)));

const executablePath =
  process.env.CHROME_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);

const tcfLesen = () =>
  new Promise((resolve) => {
    if (typeof window.__tcfapi !== 'function') return resolve(null);
    setTimeout(() => resolve(null), 3000);
    window.__tcfapi('getTCData', 2, (d, ok) => {
      if (!ok || !d) return resolve(null);
      const an = (o) => Object.entries(o || {}).filter(([, v]) => v).map(([k]) => Number(k));
      resolve({ status: d.eventStatus, zwecke: an(d.purpose?.consents), bi: an(d.purpose?.legitimateInterests), partner: an(d.vendor?.consents).length });
    });
  });

const ergebnisse = [];
async function messe(seite) {
  // je Seite ein frisches Profil = frischer Besuch ohne Cookies
  const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-echt-'));
  const ctx = await chromium.launchPersistentContext(profil, {
    executablePath,
    headless: true,
    locale: 'de-AT',
    // manche Seiten (z. B. orf.at) zeigen einem erkennbar kopflosen Browser kein Banner
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-blink-features=AutomationControlled'],
  });
  const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker').catch(() => null));
  const name = new URL(seite.url).hostname.replace(/^www\./, '');
  const r = { name, status: null, cmp: null, ereignisse: [], tcf: null };
  try {
    if (!sw) throw new Error('Erweiterung nicht gestartet');
    const page = await ctx.newPage();
    await page.goto(seite.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const ende = ['abgelehnt', 'ausgeblendet', 'pur-zugestimmt', 'pur-offen', 'fehlgeschlagen'];
    for (let i = 0; i < 50; i++) {
      await page.waitForTimeout(500);
      const s = await sw
        .evaluate(async () => {
          const tab = (await chrome.tabs.query({})).find((t) => /^https?:/.test(t.url || t.pendingUrl || ''));
          return tab && (await chrome.storage.session.get(`tab:${tab.id}`))[`tab:${tab.id}`];
        })
        .catch(() => null);
      if (s) Object.assign(r, { status: s.status, cmp: s.cmp, ereignisse: s.ereignisse.map((e) => e.text) });
      if (ende.includes(r.status) && i > 6) break;
    }
    await page.waitForTimeout(4000);
    const s = await sw
      .evaluate(async () => {
        const tab = (await chrome.tabs.query({})).find((t) => /^https?:/.test(t.url || t.pendingUrl || ''));
        return tab && (await chrome.storage.session.get(`tab:${tab.id}`))[`tab:${tab.id}`];
      })
      .catch(() => null);
    if (s) Object.assign(r, { status: s.status, cmp: s.cmp, ereignisse: s.ereignisse.map((e) => e.text) });
    r.tcf = await page.evaluate(tcfLesen).catch(() => null);
    await page.screenshot({ path: path.join(bilder, `echt-${name}.jpg`), type: 'jpeg', quality: 50, timeout: 5000 }).catch(() => {});
  } catch (e) {
    r.fehler = String(e.message).split('\n')[0];
  }
  await ctx.close().catch(() => {});
  fs.rmSync(profil, { recursive: true, force: true });
  ergebnisse.push(r);
  const tcf = r.tcf ? ` TCF: Zwecke [${r.tcf.zwecke}] BI [${r.tcf.bi}] Partner ${r.tcf.partner}` : '';
  console.log(`${name.padEnd(24)} ${String(r.status).padEnd(15)} ${String(r.cmp || '').padEnd(20)}${tcf}`);
}

let naechste = 0;
const PARALLEL = Number(process.env.PARALLEL || 3);
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (naechste < seiten.length) await messe(seiten[naechste++]);
  }),
);
ergebnisse.sort((a, b) => seiten.findIndex((s) => s.url.includes(a.name)) - seiten.findIndex((s) => s.url.includes(b.name)));
fs.writeFileSync(path.join(root, 'messung', 'ergebnisse', filter.length ? 'echt-teil.json' : 'echt.json'), JSON.stringify(ergebnisse, null, 2));
