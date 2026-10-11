// Service Worker: beantwortet die Nachrichten des autoconsent-Content-Scripts
// (Regeln + Einstellungen, Code-Schritte im Seitenkontext), entscheidet bei
// „Zustimmen oder bezahlen“ nach den Vorgaben und führt Status + Protokoll je Seite.

import { evalSnippets, filterCompactRules } from './vendor/autoconsent/autoconsent.esm.js';
import { laden, istAus, seitenName } from './lib/prefs.js';
import { abweichungen, tcfKurz } from './lib/tcf.js';
import { bereinigen as kiBereinigen, regelEinordnung, vorschlag as kiVorschlag, sicherFuer } from './lib/ki.js';

const PROTOKOLL_MAX = 20; // Einträge je Seite

let regelnCache = null;
let eigeneCache = null;
async function regeln() {
  if (!regelnCache) regelnCache = await (await fetch(chrome.runtime.getURL('vendor/autoconsent/compact-rules.json'))).json();
  return regelnCache;
}
// Eigene Regeln (autoconsent-Format) für Anbieter, die autoconsent nicht kennt, z. B. Piwik PRO
async function eigeneRegeln() {
  if (!eigeneCache) eigeneCache = await (await fetch(chrome.runtime.getURL('regeln/eigene.json'))).json();
  return eigeneCache;
}

function acConfig(prefs, url) {
  return {
    enabled: !istAus(prefs, url),
    autoAction: 'optOut',
    // Bei „nichts tun“ das Sourcepoint-Banner nicht ausblenden, damit man selbst wählen kann
    disabledCmps: prefs.pur === 'nichts' ? ['sourcepoint-top'] : [],
    enablePrehide: true,
    prehideTimeout: 2000,
    enableCosmeticRules: true,
    enableGeneratedRules: true,
    detectRetries: 20,
    enableHeuristicDetection: true, // unbekannte Banner nur erkennen …
    heuristicMode: 'off', // … nie selbst klicken
    isMainWorld: false,
    visualTest: false,
    logs: { lifecycle: false, rulesteps: false, detectionsteps: false, evals: false, errors: false, messages: false, waits: false },
  };
}

// --- Status je Tab (storage.session) und Protokoll je Seite (storage.local) ---

// Änderungen nacheinander ausführen, damit sich gleichzeitige Nachrichten nicht überschreiben
let kette = Promise.resolve();
const nacheinander = (fn) => (kette = kette.then(fn, fn));

const tabKey = (tabId) => `tab:${tabId}`;

async function tabStatus(tabId) {
  return (await chrome.storage.session.get(tabKey(tabId)))[tabKey(tabId)] || null;
}

// Rangfolge: ein späteres, „schwächeres“ Ereignis überschreibt kein stärkeres
const RANG = { suche: 0, nichts: 1, unbekannt: 2, gefunden: 3, ausgeblendet: 4, abgelehnt: 5, fehlgeschlagen: 5, abweichung: 5.5, 'pur-offen': 6, 'pur-zugestimmt': 7, aus: 8 };

const BADGE = {
  abgelehnt: ['✓', '#2e7d32'],
  ausgeblendet: ['✓', '#2e7d32'],
  'pur-zugestimmt': ['Z', '#b26a00'],
  'pur-offen': ['€', '#b26a00'],
  fehlgeschlagen: ['!', '#c62828'],
  abweichung: ['!', '#b26a00'],
  unbekannt: ['?', '#616161'],
  aus: ['aus', '#616161'],
};

function zeigeBadge(tabId, status) {
  const [text, farbe] = BADGE[status] || ['', '#000'];
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ tabId, color: farbe }).catch(() => {});
}

function aendern(tabId, fn) {
  return nacheinander(async () => {
    const alt = await tabStatus(tabId);
    if (!alt) return;
    const neu = fn(structuredClone(alt)) || alt;
    await chrome.storage.session.set({ [tabKey(tabId)]: neu });
    if (neu.status !== alt.status) zeigeBadge(tabId, neu.status);
  });
}

function setzeStatus(s, status, text, extra = {}) {
  s.ereignisse.push({ t: Date.now(), text });
  if ((RANG[status] ?? 0) >= (RANG[s.status] ?? 0)) {
    s.status = status;
    Object.assign(s, extra);
  }
  return s;
}

// TCF-Kontrolle: Nach dem Ablehnen darf laut Vorgabe nichts außer dem Notwendigen erlaubt sein.
// Läuft, sobald TCF-Daten und Ergebnis beide da sind (Reihenfolge der Nachrichten ist beliebig).
function bewerten(s) {
  if (!s.tcf || s.tcfBewertet) return s; // auch „tcloaded“: viele Seiten laden nach dem Ablehnen neu
  if (!['abgelehnt', 'ausgeblendet'].includes(s.status) || s.purLaeuft) return s;
  s.tcfBewertet = true;
  if (!s.tcf.gdpr) {
    s.ereignisse.push({ t: Date.now(), text: 'TCF-Kontrolle: DSGVO gilt laut Seite nicht' });
    return s;
  }
  const abw = abweichungen(s.tcf);
  if (!abw.length) {
    s.ereignisse.push({ t: Date.now(), text: 'TCF-Kontrolle: passt (nur Notwendiges erlaubt)' });
    return s;
  }
  s.abweichungen = abw;
  return setzeStatus(s, 'abweichung', `TCF-Kontrolle: nach dem Ablehnen noch erlaubt – ${abw.join('; ')}`);
}

function protokollieren(seite, eintrag) {
  return nacheinander(async () => {
    const { protokoll = {} } = await chrome.storage.local.get('protokoll');
    const liste = [eintrag, ...(protokoll[seite] || [])].slice(0, PROTOKOLL_MAX);
    protokoll[seite] = liste;
    await chrome.storage.local.set({ protokoll });
  });
}

// --- Nachrichten ---

async function senden(tabId, frameId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg, { frameId });
  } catch {
    // Frame inzwischen weg
  }
}

async function codeImSeitenkontext(tabId, frameId, snippetId) {
  const func = evalSnippets[snippetId];
  if (!func) return false;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, world: 'MAIN', func });
    return r?.result;
  } catch {
    return false;
  }
}

async function autoconsentNachricht(msg, sender) {
  const tabId = sender.tab?.id;
  const frameId = sender.frameId;
  if (tabId === undefined) return;
  const frameUrl = sender.url || '';
  const hauptframe = frameId === 0;
  const seitenUrl = hauptframe ? frameUrl : sender.tab.url || frameUrl;

  switch (msg.type) {
    case 'init': {
      const prefs = await laden();
      if (hauptframe) {
        const aus = istAus(prefs, seitenUrl);
        const seite = seitenName(seitenUrl);
        const neu = await nacheinander(async () => {
          const alt = await tabStatus(tabId);
          // Viele Seiten laden nach der Entscheidung neu – dann das Ergebnis behalten
          if (!aus && alt && alt.seite === seite && alt.status !== 'suche' && Date.now() - alt.start < 15000) {
            alt.ereignisse.push({ t: Date.now(), text: 'Seite neu geladen' });
            await chrome.storage.session.set({ [tabKey(tabId)]: alt });
            return alt;
          }
          const s = {
            url: seitenUrl,
            seite,
            status: aus ? 'aus' : 'suche',
            cmp: null,
            start: Date.now(),
            ereignisse: [{ t: Date.now(), text: aus ? 'auf dieser Seite ausgeschaltet' : 'Seite geladen' }],
          };
          await chrome.storage.session.set({ [tabKey(tabId)]: s });
          return s;
        });
        zeigeBadge(tabId, neu.status);
        // Banner, die autoconsent gar nicht bemerkt (kein Muster, keine Regel): später selbst nachsehen
        if (neu.status === 'suche') setTimeout(() => unbekanntesBanner(tabId, neu.start), 7000);
      }
      const rules = { autoconsent: await eigeneRegeln(), compact: filterCompactRules(await regeln(), { url: frameUrl, mainFrame: hauptframe }) };
      await senden(tabId, frameId, { type: 'initResp', rules, config: acConfig(prefs, seitenUrl) });
      break;
    }
    case 'eval': {
      const result = await codeImSeitenkontext(tabId, frameId, msg.snippetId);
      await senden(tabId, frameId, { id: msg.id, type: 'evalResp', result });
      break;
    }
    case 'popupFound':
      await aendern(tabId, (s) => setzeStatus(s, 'gefunden', `Banner gefunden (${msg.cmp})`, { cmp: msg.cmp }));
      break;
    case 'optOutResult':
      if (msg.scheduleSelfTest) await chrome.storage.session.set({ [`selbsttest:${tabId}`]: frameId });
      if (!msg.result) {
        await aendern(tabId, (s) => {
          s.ablehnenFehl = true;
          // Banner schon ausgeblendet (z. B. faz.net: Ablehnen nur mit Pur-Abo) → Seite lesbar, nichts zugestimmt
          if (s.ausgeblendet) {
            s.ereignisse.push({ t: Date.now(), text: `Ablehnen nicht möglich (${msg.cmp}) – Banner bleibt ausgeblendet, nichts zugestimmt` });
            return s;
          }
          return setzeStatus(s, 'fehlgeschlagen', `Ablehnen fehlgeschlagen (${msg.cmp})`, { cmp: msg.cmp });
        });
      }
      break;
    case 'autoconsentDone': {
      // sourcepoint-top blendet nur das äußere Banner aus; abgelehnt (oder zugestimmt) wird im Iframe
      const nurAusgeblendet = msg.isCosmetic || msg.cmp === 'sourcepoint-top';
      const status = nurAusgeblendet ? 'ausgeblendet' : 'abgelehnt';
      const text = nurAusgeblendet ? `Banner ausgeblendet (${msg.cmp})` : `abgelehnt (${msg.cmp}, ${msg.totalClicks} Klick${msg.totalClicks === 1 ? '' : 's'})`;
      await aendern(tabId, (s) => {
        if (nurAusgeblendet) {
          s.ausgeblendet = true;
          // Ablehnen ist vorher schon gescheitert: ausgeblendet statt Fehler
          if (s.status === 'fehlgeschlagen' && s.ablehnenFehl) s.status = 'ausgeblendet';
        }
        return bewerten(setzeStatus(s, status, text, { cmp: msg.cmp }));
      });
      const s = await tabStatus(tabId);
      if (s) protokollieren(s.seite, { t: Date.now(), status: s.status, cmp: msg.cmp, tcf: s.tcf ? tcfKurz(s.tcf) : undefined });
      const key = `selbsttest:${tabId}`;
      const stFrame = (await chrome.storage.session.get(key))[key];
      if (typeof stFrame === 'number') {
        await chrome.storage.session.remove(key);
        await senden(tabId, stFrame, { type: 'selfTest' });
      }
      break;
    }
    case 'selfTestResult':
      await aendern(tabId, (s) => {
        s.ereignisse.push({ t: Date.now(), text: msg.result ? 'Kontrolle: Ablehnung gespeichert' : 'Kontrolle: Ablehnung NICHT bestätigt' });
        s.selbsttest = msg.result;
      });
      break;
    case 'report': {
      // Muster eines Cookie-Banners im Text, aber (noch) keine passende Regel → Hinweis.
      // Wird ein bekanntes Banner später erkannt, überschreibt dessen Status diesen.
      if (!hauptframe) break;
      const muster = msg.state?.heuristicPatterns || [];
      const nichts = msg.state?.lifecycle === 'nothingDetected';
      if (!muster.length && !nichts) break;
      await aendern(tabId, (s) => {
        if (s.status !== 'suche' && s.status !== 'nichts') return s;
        if (muster.length) {
          if (s.status === 'unbekannt') return s;
          setTimeout(() => unbekanntesBanner(tabId), 1500); // Banner fertig aufbauen lassen
          return setzeStatus(s, 'unbekannt', 'Banner-Text erkannt, aber keine Regel – nichts geklickt');
        }
        return setzeStatus(s, 'nichts', 'kein bekanntes Banner');
      });
      break;
    }
    case 'autoconsentError':
      await aendern(tabId, (s) => {
        s.ereignisse.push({ t: Date.now(), text: `Fehler: ${String(msg.details?.msg || msg.details || '').slice(0, 120)}` });
      });
      break;
  }
}

// --- Unbekannte Banner: gemerkter Knopf, sonst Einordnung durch die lokale KI → Vorschlag im Popup ---

let offscreenBereit = null;
async function offscreen() {
  const da = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!da.length) offscreenBereit = null;
  if (!offscreenBereit) {
    offscreenBereit = (async () => {
      if (!da.length) {
        await chrome.offscreen
          .createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'Lokales Sprachmodell (Gemini Nano) für unbekannte Cookie-Banner' })
          .catch((e) => {
            if (!String(e?.message).includes('single offscreen')) throw e;
          });
      }
      // createDocument ist fertig, bevor die Skripte zuhören: auf Antwort warten
      for (let i = 0; i < 100; i++) {
        if (await chrome.runtime.sendMessage({ target: 'offscreen', type: 'ping' }).catch(() => false)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('Offscreen Document antwortet nicht');
    })().catch((e) => {
      offscreenBereit = null;
      throw e;
    });
  }
  return offscreenBereit;
}

async function anOffscreen(msg) {
  await offscreen();
  const { kiAttrappe } = await chrome.storage.local.get('kiAttrappe'); // nur automatische Tests
  return chrome.runtime.sendMessage({ target: 'offscreen', attrappe: kiAttrappe === true, ...msg });
}

let kiKette = Promise.resolve(); // Modellaufrufe nacheinander
function kiEinordnen(banner) {
  const p = kiKette.then(async () => {
    const status = await anOffscreen({ type: 'kiStatus' }).catch(() => 'unavailable');
    if (status !== 'available') return { quelle: 'regeln', einordnung: regelEinordnung(banner), grund: `KI: ${status}` };
    const r = await Promise.race([
      anOffscreen({ type: 'kiEinordnen', banner }),
      new Promise((ok) => setTimeout(() => ok({ ok: false, fehler: 'keine Antwort nach 60 s' }), 60000)),
    ]).catch((e) => ({ ok: false, fehler: String(e) }));
    if (!r?.ok) return { quelle: 'regeln', einordnung: regelEinordnung(banner), grund: `KI-Fehler: ${r?.fehler}` };
    return { quelle: 'ki', einordnung: kiBereinigen(r.einordnung, banner), ms: r.ms };
  });
  kiKette = p.catch(() => {});
  return p;
}

async function kiMessen(eintrag) {
  return nacheinander(async () => {
    const { kiMessungen = [] } = await chrome.storage.local.get('kiMessungen');
    kiMessungen.unshift({ t: Date.now(), ...eintrag });
    await chrome.storage.local.set({ kiMessungen: kiMessungen.slice(0, 300) });
  });
}

const OFFEN = ['suche', 'nichts', 'unbekannt'];

async function unbekanntesBanner(tabId, start) {
  const s0 = await tabStatus(tabId);
  if (!s0 || !OFFEN.includes(s0.status) || s0.ki || s0.kiLaeuft || (start && s0.start !== start)) return;
  await aendern(tabId, (s) => ((s.kiLaeuft = true), s));
  const banner = await chrome.tabs.sendMessage(tabId, { type: 'ch:bannerLesen' }, { frameId: 0 }).catch(() => null);
  if (!banner?.knoepfe?.length) {
    await aendern(tabId, (s) => {
      s.kiLaeuft = false;
      if (s.status !== 'unbekannt') return s;
      s.status = 'nichts';
      s.ereignisse.push({ t: Date.now(), text: 'kein Banner mit Knöpfen gefunden' });
      return s;
    });
    return;
  }
  await aendern(tabId, (s) => (OFFEN.includes(s.status) && s.status !== 'unbekannt' ? setzeStatus(s, 'unbekannt', 'Banner ohne passende Regel gefunden') : s));

  // Auf dieser Seite schon einmal bestätigt? Dann denselben Knopf wieder klicken.
  const { gelernt = {} } = await chrome.storage.local.get('gelernt');
  const gemerkt = banner.knoepfe.find((k) => (gelernt[s0.seite] || []).includes(k.text) && sicherFuer(banner, k.text));
  if (gemerkt) {
    await klickAusfuehren(tabId, gemerkt, 'gemerkt');
    return;
  }

  const prefs = await laden();
  // „Selbst klicken“: sofort nach festen Regeln, ohne auf das Modell zu warten (Messung 0.4.2)
  const regelV = kiVorschlag(regelEinordnung(banner), banner);
  if (regelV && prefs.ki === 'selbst') {
    await aendern(tabId, (s) => ((s.kiLaeuft = false), s));
    const ok = await klickAusfuehren(tabId, regelV, 'selbst');
    kiMessen({ seite: s0.seite, entscheidung: ok ? 'selbst' : 'klick-fehler', vorschlag: regelV.text });
    return;
  }
  const r = prefs.ki === 'aus' ? { quelle: 'regeln', einordnung: regelEinordnung(banner), grund: 'KI ausgeschaltet' } : await kiEinordnen(banner);
  const v = kiVorschlag(r.einordnung, banner); // Regeln wählen den Knopf, das Modell darf nur bremsen
  await aendern(tabId, (s) => {
    s.kiLaeuft = false;
    if (s.status !== 'unbekannt') return s;
    const art = new Map(r.einordnung.knoepfe.map((k) => [k.nr, k.art]));
    s.ki = {
      quelle: r.quelle,
      grund: r.grund,
      zusammenfassung: r.einordnung.zusammenfassung,
      zwecke: r.einordnung.zwecke,
      partner: r.einordnung.partner,
      pur: r.einordnung.zustimmenOderBezahlen,
      knoepfe: banner.knoepfe.map((k) => ({ ...k, art: art.get(k.nr) || 'sonstiges' })),
      vorschlag: v,
    };
    const wer = r.quelle === 'ki' ? `KI (${Math.round((r.ms || 0) / 100) / 10} s)` : `Regeln${r.grund ? ` – ${r.grund}` : ''}`;
    s.ereignisse.push({ t: Date.now(), text: v ? `${wer}: Vorschlag „${v.text}“ – wartet auf Bestätigung` : `${wer}: kein sicherer Ablehnen-Knopf` });
    return s;
  });
  kiMessen({ seite: s0.seite, quelle: r.quelle, knoepfe: banner.knoepfe.map((k) => ({ text: k.text, art: r.einordnung.knoepfe.find((x) => x.nr === k.nr)?.art })), vorschlag: v?.text || null });
}

async function klickAusfuehren(tabId, knopf, wie) {
  const r = await chrome.tabs.sendMessage(tabId, { type: 'ch:klick', nr: knopf.nr, text: knopf.text }, { frameId: 0 }).catch(() => null);
  const s = await tabStatus(tabId);
  if (!r?.ok) {
    await aendern(tabId, (x) => setzeStatus(x, 'fehlgeschlagen', `Klick auf „${knopf.text}“ nicht möglich (${r?.grund || 'keine Antwort'})`));
    return false;
  }
  const cmp = { gemerkt: 'gemerkter Knopf', selbst: 'selbst geklickt' }[wie] || 'Vorschlag';
  const was = knopf.hinweis ? 'Hinweis geschlossen' : 'abgelehnt';
  await aendern(tabId, (x) => bewerten(setzeStatus(x, 'abgelehnt', `${was}: „${knopf.text}“ (${cmp})`, { cmp })));
  if (s) protokollieren(s.seite, { t: Date.now(), status: 'abgelehnt', cmp });
  return true;
}

async function eigeneNachricht(msg, sender) {
  if (msg.type === 'ch:kiKlick' || msg.type === 'ch:kiNein') {
    // vom Popup: msg.tabId statt sender.tab
    const s = await tabStatus(msg.tabId);
    const v = s?.ki?.vorschlag;
    if (!v) return { ok: false };
    if (msg.type === 'ch:kiNein') {
      await aendern(msg.tabId, (x) => ((x.ki.verworfen = true), x.ereignisse.push({ t: Date.now(), text: 'Vorschlag verworfen' }), x));
      kiMessen({ seite: s.seite, entscheidung: 'nein', vorschlag: v.text });
      return { ok: true };
    }
    const ok = await klickAusfuehren(msg.tabId, v, 'vorschlag');
    kiMessen({ seite: s.seite, entscheidung: ok ? 'geklickt' : 'klick-fehler', vorschlag: v.text });
    if (ok && msg.merken) {
      await nacheinander(async () => {
        const { gelernt = {} } = await chrome.storage.local.get('gelernt');
        gelernt[s.seite] = [...new Set([...(gelernt[s.seite] || []), v.text])].slice(-5);
        await chrome.storage.local.set({ gelernt });
      });
    }
    return { ok };
  }

  const tabId = sender.tab?.id;
  const seitenUrl = sender.tab?.url || sender.url || '';
  switch (msg.type) {
    case 'ch:tcf': {
      if (sender.frameId !== 0) return null;
      let vorher = null;
      let nachher = null;
      await aendern(tabId, (s) => {
        vorher = s.status;
        s.tcf = msg.daten;
        const neu = msg.daten.status === 'tcloaded' ? 'gespeicherte Entscheidung' : 'Entscheidung';
        s.ereignisse.push({ t: Date.now(), text: `TCF (${neu}): ${tcfKurz(msg.daten)}` });
        bewerten(s);
        nachher = s.status;
        return s;
      });
      if (nachher === 'abweichung' && vorher !== 'abweichung') {
        const s = await tabStatus(tabId);
        protokollieren(s.seite, { t: Date.now(), status: 'abweichung', cmp: s.cmp, tcf: tcfKurz(s.tcf) });
      }
      return { ok: true };
    }
    case 'ch:pur': {
      const prefs = await laden();
      const aktion = istAus(prefs, seitenUrl) ? 'aus' : prefs.pur;
      if (aktion === 'zustimmen') await aendern(tabId, (s) => ((s.purLaeuft = true), s));
      if (aktion === 'nichts') {
        await aendern(tabId, (s) => setzeStatus(s, 'pur-offen', `Zustimmen oder bezahlen (${msg.cmp}) – laut Vorgabe nichts getan`, { cmp: msg.cmp }));
        protokollieren(seitenName(seitenUrl), { t: Date.now(), status: 'pur-offen', cmp: msg.cmp });
      }
      return { aktion };
    }
    case 'ch:purErgebnis': {
      const status = msg.erfolg ? 'pur-zugestimmt' : 'fehlgeschlagen';
      const text = msg.erfolg ? `Zustimmen oder bezahlen: zugestimmt („${msg.knopf}“, ${msg.cmp})` : `${msg.cmp}: ${msg.grund} („${msg.knopf}“)`;
      await aendern(tabId, (s) => setzeStatus(s, status, text, { cmp: msg.cmp }));
      protokollieren(seitenName(seitenUrl), { t: Date.now(), status, cmp: msg.cmp });
      return { ok: true };
    }
  }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type.startsWith('ch:')) {
    eigeneNachricht(msg, sender).then(sendResponse, () => sendResponse(null));
    return true; // Antwort kommt asynchron
  }
  autoconsentNachricht(msg, sender).catch((e) => console.error('Cookie-Helfer:', e));
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([tabKey(tabId), `selbsttest:${tabId}`]);
});
