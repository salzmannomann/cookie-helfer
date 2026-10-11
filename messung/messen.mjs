// Messung vorab (Schritt 1): Für jede Seite aus seiten.json wird geprüft,
// welcher Banner-Anbieter (CMP) erkannt wird, ob autoconsent den Banner per
// „Ablehnen“ (opt-out) erledigt, ob es nach „Zustimmen oder bezahlen“ aussieht
// und was danach in TCF (__tcfapi) steht.
//
// Aufruf:  npm run messung              (alle Seiten)
//          npm run messung -- orf spiegel   (nur Seiten, deren URL das Wort enthält)
// Ergebnis: messung/ergebnisse/ergebnis.json und messung/ergebnisse/bericht.md
//
// Es wird nichts gekauft und kein Formular ausgefüllt: autoconsent klickt nur
// in bekannten Bannern auf „Ablehnen“ bzw. „Auswahl speichern“.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const hier = path.dirname(fileURLToPath(import.meta.url));
const acDir = path.join(hier, '..', 'node_modules', '@duckduckgo', 'autoconsent');
const contentScript = fs.readFileSync(path.join(acDir, 'dist/autoconsent.playwright.js'), 'utf8');
const rules = require('@duckduckgo/autoconsent/rules/rules.json');
const acVersion = JSON.parse(fs.readFileSync(path.join(acDir, 'package.json'), 'utf8')).version;

const ausgabe = path.join(hier, 'ergebnisse');
const bilder = path.join(ausgabe, 'bilder');
fs.mkdirSync(bilder, { recursive: true });

const filter = process.argv.slice(2);
let seiten = JSON.parse(fs.readFileSync(path.join(hier, 'seiten.json'), 'utf8'));
if (filter.length) seiten = seiten.filter((s) => filter.some((f) => s.url.includes(f)));

const PARALLEL = Number(process.env.PARALLEL || 4);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const executablePath =
  process.env.CHROME_PATH ||
  (fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const acConfig = {
  enabled: true,
  autoAction: 'optOut',
  disabledCmps: [],
  enablePrehide: false,
  enableCosmeticRules: true,
  enableGeneratedRules: true,
  enableHeuristicDetection: true, // nur erkennen, nicht klicken (heuristicMode: off)
  heuristicMode: 'off',
  detectRetries: 20,
  visualTest: false,
};

// Läuft im Seitenkontext jedes Frames: sammelt den Text von Elementen, die wie
// ein Banner aussehen (fixed/sticky, dialog, aria-modal), auch in Shadow DOM.
// In Unter-Frames (CMP-Iframes) wird der ganze Text genommen.
const bannerTextFn = () => {
  const texte = [];
  const knoepfe = [];
  const top = window === window.top;
  const sichtbar = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 50 && r.height > 20;
  };
  const sammle = (wurzel) => {
    const els = wurzel.querySelectorAll('*');
    for (const el of els) {
      if (el.shadowRoot) sammle(el.shadowRoot);
      let cs;
      try { cs = getComputedStyle(el); } catch { continue; }
      const fix = cs.position === 'fixed' || cs.position === 'sticky';
      const dlg = el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true' || el.tagName === 'DIALOG';
      if ((fix || dlg) && cs.display !== 'none' && cs.visibility !== 'hidden' && sichtbar(el)) {
        const t = (el.innerText || '').trim();
        if (t.length > 40) texte.push(t);
        if (el.shadowRoot) {
          const st = (el.shadowRoot.textContent || '').replace(/\s+/g, ' ').trim();
          if (st.length > 40) texte.push(st);
        }
      }
    }
  };
  if (top) {
    sammle(document);
  } else if (document.body && sichtbar(document.body)) {
    texte.push((document.body.innerText || '').trim());
  }
  const text = [...new Set(texte)].join('\n---\n').slice(0, 20000);
  if (text) {
    // Knöpfe im (vermuteten) Banner – Grundlage für spätere KI-Zuordnung
    const roots = [document];
    const walk = (r) => r.querySelectorAll('*').forEach((e) => e.shadowRoot && (roots.push(e.shadowRoot), walk(e.shadowRoot)));
    walk(document);
    for (const r of roots) {
      r.querySelectorAll('button, a[role=button], [role=button], input[type=button], input[type=submit]').forEach((b) => {
        const t = (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
        if (t && t.length < 80 && sichtbar(b) && text.includes(t)) knoepfe.push(t);
      });
    }
  }
  return { text, knoepfe: [...new Set(knoepfe)].slice(0, 30) };
};

// „Zustimmen oder bezahlen“ (Pur-Abo, contentpass …)
const PUR_MUSTER = [
  /\bpur[- ]?(abo|abonnement|modell|angebot)\b/i,
  /\bcontentpass\b/i,
  /\bpur\b[^.\n]{0,20}abonnier/i,
  /\bpur\b[^.\n]{0,80}(€|euro)\s*\/?\s*monat/i,
  /(weiter|weiterlesen|nutzen)\s+mit\s+werbung|mit\s+werbung\s+(weiter|weiterlesen|nutzen)/i,
  /werbefrei(?:es|en)?\s+(lesen|abo|nutzen|surfen|angebot)/i,
  /ohne\s+(personalisierte\s+)?werbung[^.\n]{0,100}(€|euro|abo|monat)/i,
  /(werbe|tracking)frei[^.\n]{0,80}(€|euro)/i,
  /(zustimmen|akzeptieren|einwilligen)[^.\n]{0,60}\boder\b[^.\n]{0,60}(abo|abonnier|bezahl|zahlen)/i,
  /\b(accept|consent)[^.\n]{0,60}\bor\b[^.\n]{0,60}(subscribe|pay)\b/i,
];
const purTreffer = (text) => {
  for (const m of PUR_MUSTER) {
    const t = text.match(m);
    if (t) return t[0].replace(/\s+/g, ' ').slice(0, 120);
  }
  return null;
};

const tcfLesen = () =>
  new Promise((resolve) => {
    if (typeof window.__tcfapi !== 'function') return resolve(null);
    const timer = setTimeout(() => resolve({ fehler: 'keine Antwort' }), 3000);
    try {
      window.__tcfapi('getTCData', 2, (d, ok) => {
        clearTimeout(timer);
        if (!ok || !d) return resolve({ fehler: 'getTCData fehlgeschlagen' });
        const an = (o) => Object.entries(o || {}).filter(([, v]) => v).map(([k]) => Number(k));
        resolve({
          cmpId: d.cmpId,
          gdprApplies: d.gdprApplies,
          eventStatus: d.eventStatus,
          cmpStatus: d.cmpStatus,
          hatString: !!d.tcString,
          zwecke: an(d.purpose?.consents),
          berechtigtesInteresse: an(d.purpose?.legitimateInterests),
          besondereMerkmale: an(d.specialFeatureOptins),
          partnerZustimmung: an(d.vendor?.consents).length,
          partnerBerechtigtesInteresse: an(d.vendor?.legitimateInterests).length,
          publisherZwecke: an(d.publisher?.consents),
        });
      });
    } catch (e) {
      clearTimeout(timer);
      resolve({ fehler: String(e) });
    }
  });

// Nach dem Klick: Ist die Seite noch gesperrt (unscharf, Scrollen aus)?
const sperreFn = () => {
  const ov = (el) => el && getComputedStyle(el).overflow === 'hidden' && getComputedStyle(el).overflowY === 'hidden';
  let unscharf = false;
  for (const el of document.querySelectorAll('body *')) {
    const f = getComputedStyle(el).filter;
    if (f && f.includes('blur')) {
      const r = el.getBoundingClientRect();
      if (r.width * r.height > 0.3 * innerWidth * innerHeight) { unscharf = true; break; }
    }
  }
  return { unscharf, scrollGesperrt: ov(document.documentElement) || ov(document.body) };
};
const CONSENT_WORT = /cookie|zustimm|einwillig|consent|datenschutz|tracking|partner/i;
const CONSENT_KNOPF = /zustimm|akzeptier|einverstanden|einwillig|annehmen|ablehnen|accept|agree|reject|alle(n)? (cookies|zwecken)|nur (notwendige|essenzielle|essentielle)/i;

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function messeSeite(browser, seite) {
  const ctx = await browser.newContext({
    locale: 'de-AT',
    timezoneId: 'Europe/Vienna',
    userAgent: UA,
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'de-AT,de;q=0.9,en;q=0.5' },
  });
  const page = await ctx.newPage();
  const name = new URL(seite.url).hostname.replace(/^www\./, '');
  const r = {
    url: seite.url,
    gruppe: seite.gruppe,
    name,
    erkannt: [],
    popup: [],
    optOut: null,
    selbsttest: null,
    fertig: null,
    heuristik: [],
    fehler: [],
    pur: null,
    bannertext: '',
    knoepfe: [],
    tcfVorher: null,
    tcfNachher: null,
  };
  const empfangen = [];
  let selbsttestFrame = null;

  const bannerAufnehmen = async () => {
    for (const f of page.frames()) {
      try {
        const b = await f.evaluate(bannerTextFn);
        if (!b?.text) continue;
        const p = purTreffer(b.text);
        if (p && !r.pur) r.pur = { treffer: p, frame: f === page.mainFrame() ? 'Hauptseite' : new URL(f.url()).hostname };
        if (b.text.length > r.bannertext.length) {
          r.bannertext = b.text.slice(0, 1500);
          r.knoepfe = b.knoepfe;
        }
      } catch {}
    }
  };

  await page.exposeBinding('autoconsentSendMessage', async ({ frame }, msg) => {
    empfangen.push(msg);
    switch (msg.type) {
      case 'init':
        await frame
          .evaluate(`autoconsentReceiveMessage({ type: "initResp", config: ${JSON.stringify(acConfig)}, rules: ${JSON.stringify(rules)} })`)
          .catch(() => {});
        break;
      case 'eval': {
        let result = false;
        try { result = await frame.evaluate(msg.code); } catch {}
        await frame
          .evaluate(`autoconsentReceiveMessage({ id: "${msg.id}", type: "evalResp", result: ${JSON.stringify(result)} })`)
          .catch(() => {});
        break;
      }
      case 'cmpDetected':
        if (!r.erkannt.includes(msg.cmp)) r.erkannt.push(msg.cmp);
        break;
      case 'popupFound':
        if (!r.popup.includes(msg.cmp)) r.popup.push(msg.cmp);
        // Zustand vor dem Klick festhalten
        await page.screenshot({ path: path.join(bilder, `${name}-1-banner.jpg`), type: 'jpeg', quality: 50, timeout: 3000 }).catch(() => {});
        await bannerAufnehmen();
        r.tcfVorher = await page.evaluate(tcfLesen).catch(() => null);
        break;
      case 'optOutResult':
        r.optOut = msg.result;
        if (msg.scheduleSelfTest) selbsttestFrame = frame;
        break;
      case 'selfTestResult':
        r.selbsttest = msg.result;
        break;
      case 'autoconsentDone':
        r.fertig = { cmp: msg.cmp, kosmetisch: msg.isCosmetic, klicks: msg.totalClicks, dauerMs: Math.round(msg.duration) };
        if (selbsttestFrame) await selbsttestFrame.evaluate(`autoconsentReceiveMessage({ type: "selfTest" })`).catch(() => {});
        break;
      case 'report':
        for (const p of msg.state?.heuristicPatterns || []) if (!r.heuristik.includes(p)) r.heuristik.push(p);
        break;
      case 'autoconsentError':
        r.fehler.push(String(msg.details?.msg || JSON.stringify(msg.details)).slice(0, 200));
        break;
    }
  });

  const inject = (f) => f.evaluate(contentScript).catch(() => {});
  page.on('framenavigated', inject);

  try {
    await page.goto(seite.url, { waitUntil: 'commit', timeout: 30000 });
    await inject(page);
    page.frames().forEach(inject);
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});

    // warten, bis autoconsent fertig ist oder nichts mehr passiert
    const start = Date.now();
    while (Date.now() - start < 35000) {
      if (r.fertig && (r.selbsttest !== null || !selbsttestFrame || Date.now() - start > 25000)) break;
      if (!r.erkannt.length && Date.now() - start > 15000) break; // kein Anbieter erkannt
      await warte(500);
    }
    await warte(2500);
    if (!r.popup.length) await bannerAufnehmen(); // unbekannte Banner: Text trotzdem aufnehmen
    r.tcfNachher = await page.evaluate(tcfLesen).catch(() => null);
    r.sperre = await page.evaluate(sperreFn).catch(() => null);
    r.bannerNochDa = false;
    for (const f of page.frames()) {
      const b = await f.evaluate(bannerTextFn).catch(() => null);
      if (b?.text && CONSENT_WORT.test(b.text) && b.knoepfe.some((k) => CONSENT_KNOPF.test(k))) { r.bannerNochDa = true; break; }
    }
    r.endUrl = page.url();
    r.cookies = (await ctx.cookies()).length;
    await page.screenshot({ path: path.join(bilder, `${name}-2-nachher.jpg`), type: 'jpeg', quality: 50, timeout: 3000 }).catch(() => {});
  } catch (e) {
    r.fehler.push(String(e.message || e).split('\n')[0].slice(0, 200));
  } finally {
    await ctx.close().catch(() => {});
  }
  r.ergebnis = einordnen(r);
  return r;
}

function einordnen(r) {
  if (r.fehler.some((f) => /net::|Timeout|timeout/.test(f)) && !r.erkannt.length) return 'Seite nicht geladen';
  const gesperrt = r.sperre?.unscharf || r.bannerNochDa;
  if (r.pur && (gesperrt || r.optOut !== true)) return 'Zustimmen oder bezahlen (offen)';
  if (r.optOut === true && gesperrt) return 'Klick ok, Seite aber noch gesperrt';
  if (r.optOut === true) return r.fertig?.kosmetisch ? 'ausgeblendet (nur kosmetisch)' : 'abgelehnt (autoconsent)';
  if (r.optOut === false) return 'Ablehnen fehlgeschlagen';
  if (r.popup.length) return 'Banner gefunden, kein Ergebnis';
  if (r.erkannt.length) return 'Anbieter erkannt, kein Banner offen';
  if (CONSENT_WORT.test(r.bannertext) && r.knoepfe.some((k) => CONSENT_KNOPF.test(k))) return 'unbekanntes Banner';
  if (r.heuristik.length) return 'evtl. Banner (nur Heuristik)';
  return 'kein Banner';
}

// --- Lauf ---
const browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-blink-features=AutomationControlled'] });
const ergebnisse = [];
let naechste = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (naechste < seiten.length) {
      const s = seiten[naechste++];
      // harte Obergrenze je Seite, damit eine hängende Seite den Lauf nicht blockiert
      const r = await Promise.race([
        messeSeite(browser, s),
        warte(90000).then(() => ({ url: s.url, gruppe: s.gruppe, name: new URL(s.url).hostname.replace(/^www\./, ''), erkannt: [], popup: [], heuristik: [], knoepfe: [], bannertext: '', fehler: ['Zeitüberschreitung (90 s)'], ergebnis: 'Seite nicht geladen' })),
      ]);
      ergebnisse.push(r);
      console.log(`${r.name.padEnd(26)} ${r.ergebnis.padEnd(36)} ${r.popup.join(',') || r.erkannt.join(',') || ''}${r.pur ? '  [PUR: ' + r.pur.treffer + ']' : ''}`);
    }
  }),
);
await browser.close();

ergebnisse.sort((a, b) => seiten.findIndex((s) => s.url === a.url) - seiten.findIndex((s) => s.url === b.url));
let herkunft = null;
try {
  herkunft = await (await fetch('https://ipinfo.io/json')).json();
} catch {}
const meta = {
  datum: new Date().toISOString(),
  autoconsent: acVersion,
  regeln: rules.autoconsent.length,
  standort: herkunft ? `${herkunft.city}, ${herkunft.country}` : 'unbekannt',
};
fs.writeFileSync(path.join(ausgabe, filter.length ? 'teil.json' : 'ergebnis.json'), JSON.stringify({ meta, ergebnisse }, null, 2));
if (!filter.length) {
  const { bericht } = await import('./bericht.mjs');
  fs.writeFileSync(path.join(ausgabe, 'bericht.md'), bericht(meta, ergebnisse));
  console.log(`\nGeschrieben: messung/ergebnisse/ergebnis.json, bericht.md (Standort ${meta.standort})`);
}
