// End-to-End-Test: echte Erweiterung in Chromium, nachgebaute Banner von test/site/.
// Prüft: Banner werden nach Vorgabe beantwortet, nie ein Abo-Knopf, Ausnahmen wirken.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'test', 'site');
const extension = path.join(root, 'extension');

const server = http.createServer((req, res) => {
  const name = path.basename(new URL(req.url, 'http://x').pathname) || 'index.html';
  const datei = path.join(site, name);
  if (!fs.existsSync(datei)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': name.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(datei));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const basis = `http://localhost:${server.address().port}`;

async function warteAuf(fn, ms = 15000) {
  const start = Date.now();
  let letzter;
  while (Date.now() - start < ms) {
    letzter = await fn();
    if (letzter) return letzter;
    await new Promise((r) => setTimeout(r, 250));
  }
  return letzter;
}

const executablePath =
  process.env.CHROME_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined);
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-test-'));
const ctx = await chromium.launchPersistentContext(profil, {
  executablePath,
  headless: true,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker'));
// warten, bis die Erweiterungs-APIs im Service Worker bereitstehen
await warteAuf(() => sw.evaluate(() => typeof chrome !== 'undefined' && !!chrome.storage?.local).catch(() => false), 10000);
const swFehler = [];
sw.on?.('console', (m) => m.type() === 'error' && swFehler.push(m.text()));

const setzePrefs = (prefs) => sw.evaluate((p) => chrome.storage.local.set({ prefs: p }), prefs);
const status = (url) =>
  sw.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u });
    if (!tab) return null;
    return (await chrome.storage.session.get(`tab:${tab.id}`))[`tab:${tab.id}`];
  }, url);


// Öffnet eine Testseite, wartet bis der Status zu `erwartet` passt (oder Zeit um) und liefert Klicks + Status
async function oeffnen(name, erwartet, ms = 15000) {
  const page = await ctx.newPage();
  const url = `${basis}/${name}`;
  await page.goto(url);
  const s = await warteAuf(async () => {
    const st = await status(url);
    return st && erwartet.includes(st.status) ? st : null;
  }, ms);
  await page.waitForTimeout(1500); // eventuelle Nachzügler-Klicks abwarten
  const geklickt = await page.evaluate(() => window.geklickt);
  const endStatus = s || (await status(url));
  await page.close();
  return { geklickt, status: endStatus?.status, s: endStatus };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const STANDARD = { aktiv: true, pur: 'zustimmen', ausnahmen: {} };

test('Sourcepoint „Zustimmen oder bezahlen“: Zustimmen geklickt, nie Abo', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('sp-pur.html', ['pur-zugestimmt']);
  assert.deepEqual(r.geklickt, ['sp_choice_type_11']);
  assert.equal(r.status, 'pur-zugestimmt');
});

test('Sourcepoint nur „Zustimmen“ möglich (wie golem.de): zugestimmt', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('sp-nurzustimmen.html', ['pur-zugestimmt']);
  assert.deepEqual(r.geklickt, ['sp_choice_type_11']);
});

test('Sourcepoint normales Banner: abgelehnt, nicht zugestimmt', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('sp-normal.html', ['abgelehnt'], 20000);
  await new Promise((x) => setTimeout(x, 500));
  assert.deepEqual(r.geklickt, ['sp_choice_type_13']);
});

test('Sourcepoint: Ablehnen-Knopf erscheint verzögert → nicht als „nur Zustimmen“ behandelt', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('sp-spaet.html', ['abgelehnt', 'fehlgeschlagen'], 8000);
  assert.ok(!r.geklickt.includes('sp_choice_type_11'), `geklickt: ${r.geklickt}`);
  assert.notEqual(r.status, 'pur-zugestimmt');
});

test('Zustimmen-Knopf mit Abo-Text wird nicht geklickt', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('sp-trick.html', ['fehlgeschlagen']);
  assert.deepEqual(r.geklickt, []);
  assert.equal(r.status, 'fehlgeschlagen');
});

test('consentmanager Pur (wie chefkoch.de): zugestimmt, nie Abo', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('cmp-pur.html', ['pur-zugestimmt']);
  assert.deepEqual(r.geklickt, ['cmp-ja']);
});

test('Didomi mit „Pur kaufen“ (wie kleinezeitung.at): Alle akzeptieren, nie kaufen', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('didomi-pur.html', ['pur-zugestimmt'], 20000);
  assert.deepEqual(r.geklickt, ['d-alle']);
  assert.equal(r.status, 'pur-zugestimmt');
});

test('contentpass im Shadow DOM (wie wetter.com): zugestimmt, nie Abo', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('contentpass.html', ['pur-zugestimmt']);
  assert.deepEqual(r.geklickt, ['cp-ja']);
});

test('OneTrust: abgelehnt über autoconsent', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('onetrust.html', ['abgelehnt'], 20000);
  assert.deepEqual(r.geklickt, ['ot-nein']);
  assert.equal(r.s.cmp, 'Onetrust');
});

test('Piwik PRO (eigene Regel): abgelehnt', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('piwik.html', ['abgelehnt'], 20000);
  assert.deepEqual(r.geklickt, ['pp-nein']);
  assert.equal(r.s.cmp, 'piwik-pro');
});

test('TCF-Kontrolle: nach dem Ablehnen nur Notwendiges → passt', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('onetrust.html', ['abgelehnt'], 20000);
  assert.equal(r.status, 'abgelehnt');
  assert.ok(r.s.tcf, 'TCF-Daten vorhanden');
  assert.ok(r.s.ereignisse.some((e) => e.text.includes('TCF-Kontrolle: passt')), JSON.stringify(r.s.ereignisse));
});

test('TCF-Kontrolle: berechtigtes Interesse bleibt an → Hinweis', async () => {
  await setzePrefs(STANDARD);
  const r = await oeffnen('onetrust.html?bi=2,7', ['abweichung'], 20000);
  assert.equal(r.status, 'abweichung');
  assert.deepEqual(r.s.abweichungen, ['berechtigtes Interesse: einfache Werbung, Werbemessung', '12 Partner mit Zustimmung']);
  const { protokoll } = await sw.evaluate(() => chrome.storage.local.get('protokoll'));
  assert.equal(protokoll.localhost[0].status, 'abweichung');
});

test('Unbekanntes Banner: nichts geklickt, aber Vorschlag „Nur notwendige“', async () => {
  await setzePrefs(STANDARD);
  await sw.evaluate(() => chrome.storage.local.set({ kiAttrappe: true, gelernt: {} }));
  const page = await ctx.newPage();
  const url = `${basis}/unbekannt.html`;
  await page.goto(url);
  const s = await warteAuf(async () => { const st = await status(url); return st?.ki ? st : null; }, 40000);
  assert.ok(s, 'Einordnung vorhanden');
  assert.equal(s.status, 'unbekannt');
  assert.deepEqual(s.ki.vorschlag, { nr: 2, text: 'Nur notwendige' });
  assert.equal(s.ki.quelle, 'ki');
  assert.deepEqual(await page.evaluate(() => window.geklickt), [], 'ohne Bestätigung nichts geklickt');

  // Bestätigen im Popup → Klick, Status abgelehnt, Knopf gemerkt
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html?tab=${tabId}`);
  await popup.waitForSelector('#kiFrage:not([hidden])');
  assert.equal(await popup.textContent('#kiKnopf'), 'Nur notwendige');
  await popup.click('#kiJa');
  await warteAuf(async () => (await status(url))?.status === 'abgelehnt', 5000);
  assert.deepEqual(await page.evaluate(() => window.geklickt), ['u-nein']);
  const gelernt = await warteAuf(async () => {
    const { gelernt: g } = await sw.evaluate(() => chrome.storage.local.get('gelernt'));
    return g?.localhost ? g : null;
  }, 3000);
  assert.deepEqual(gelernt, { localhost: ['Nur notwendige'] });
  await popup.close();
  await page.close();

  // Nächster Besuch: gemerkter Knopf wird selbst geklickt
  const r = await oeffnen('unbekannt.html', ['abgelehnt'], 40000);
  assert.deepEqual(r.geklickt, ['u-nein']);
  assert.equal(r.s.cmp, 'gemerkter Knopf');
  await sw.evaluate(() => chrome.storage.local.set({ gelernt: {} }));
});

test('Unbekanntes Banner ohne sicheren Ablehnen-Knopf: kein Vorschlag, nichts geklickt', async () => {
  await setzePrefs(STANDARD);
  const page = await ctx.newPage();
  const url = `${basis}/unbekannt-ohne.html`;
  await page.goto(url);
  const s = await warteAuf(async () => { const st = await status(url); return st?.ki ? st : null; }, 40000);
  assert.ok(s, 'Einordnung vorhanden');
  assert.equal(s.ki.vorschlag, null);
  await page.waitForTimeout(1000);
  assert.deepEqual(await page.evaluate(() => window.geklickt), []);
  await page.close();
});

test('Vorgabe „nichts tun“: Pur-Banner bleibt offen, Hinweis', async () => {
  await setzePrefs({ ...STANDARD, pur: 'nichts' });
  const r = await oeffnen('sp-pur.html', ['pur-offen']);
  assert.deepEqual(r.geklickt, []);
  assert.equal(r.status, 'pur-offen');
});

test('Ausnahme „auf dieser Seite aus“: gar nichts geklickt', async () => {
  await setzePrefs({ ...STANDARD, ausnahmen: { localhost: 'aus' } });
  for (const seite of ['sp-pur.html', 'onetrust.html']) {
    const r = await oeffnen(seite, ['nie'], 5000);
    assert.deepEqual(r.geklickt, [], seite);
    assert.equal(r.status, 'aus', seite);
  }
});

test('Protokoll je Seite wird geführt', async () => {
  const { protokoll } = await sw.evaluate(() => chrome.storage.local.get('protokoll'));
  assert.ok(protokoll.localhost?.length >= 3, 'mindestens drei Einträge für localhost');
  assert.ok(protokoll.localhost.some((e) => e.status === 'pur-zugestimmt'));
});

test('Popup zeigt den Status der Seite', async () => {
  await setzePrefs(STANDARD);
  const page = await ctx.newPage();
  const url = `${basis}/onetrust.html`;
  await page.goto(url);
  await warteAuf(async () => (await status(url))?.status === 'abgelehnt', 20000);
  const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0].id, url);
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup.html?tab=${tabId}`);
  await popup.waitForSelector('#status b');
  await popup.waitForFunction(() => document.querySelector('#status b').textContent === 'Abgelehnt');
  assert.equal(await popup.textContent('#seite'), 'localhost');
  assert.equal(await popup.textContent('#tcfListe'), '✓ nur Notwendiges erlaubt');
  await popup.close();
  await page.close();
});

let fehler = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`✓ ${t.name}`);
  } catch (e) {
    fehler++;
    console.log(`✗ ${t.name}\n    ${e.message.split('\n').join('\n    ')}`);
  }
}
if (swFehler.length) console.log('Fehler im Service Worker:\n  ' + swFehler.join('\n  '));
await ctx.close();
server.close();
fs.rmSync(profil, { recursive: true, force: true });
console.log(fehler ? `\n${fehler} von ${tests.length} Tests fehlgeschlagen` : `\nAlle ${tests.length} Tests grün`);
process.exit(fehler ? 1 : 0);
