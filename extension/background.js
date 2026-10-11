// Service Worker: beantwortet die Nachrichten des autoconsent-Content-Scripts
// (Regeln + Einstellungen, Code-Schritte im Seitenkontext), entscheidet bei
// „Zustimmen oder bezahlen“ nach den Vorgaben und führt Status + Protokoll je Seite.

import { evalSnippets, filterCompactRules } from './vendor/autoconsent/autoconsent.esm.js';
import { laden, istAus, seitenName } from './lib/prefs.js';

const PROTOKOLL_MAX = 20; // Einträge je Seite

let regelnCache = null;
async function regeln() {
  if (!regelnCache) regelnCache = await (await fetch(chrome.runtime.getURL('vendor/autoconsent/compact-rules.json'))).json();
  return regelnCache;
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
const RANG = { suche: 0, nichts: 1, unbekannt: 2, gefunden: 3, ausgeblendet: 4, abgelehnt: 5, fehlgeschlagen: 5, 'pur-offen': 6, 'pur-zugestimmt': 7, aus: 8 };

const BADGE = {
  abgelehnt: ['✓', '#2e7d32'],
  ausgeblendet: ['✓', '#2e7d32'],
  'pur-zugestimmt': ['Z', '#b26a00'],
  'pur-offen': ['€', '#b26a00'],
  fehlgeschlagen: ['!', '#c62828'],
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
      }
      const rules = { autoconsent: [], compact: filterCompactRules(await regeln(), { url: frameUrl, mainFrame: hauptframe }) };
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
        await aendern(tabId, (s) => setzeStatus(s, 'fehlgeschlagen', `Ablehnen fehlgeschlagen (${msg.cmp})`, { cmp: msg.cmp }));
      }
      break;
    case 'autoconsentDone': {
      const status = msg.isCosmetic ? 'ausgeblendet' : 'abgelehnt';
      const text = msg.isCosmetic ? `Banner ausgeblendet (${msg.cmp})` : `abgelehnt (${msg.cmp}, ${msg.totalClicks} Klick${msg.totalClicks === 1 ? '' : 's'})`;
      await aendern(tabId, (s) => setzeStatus(s, status, text, { cmp: msg.cmp }));
      const s = await tabStatus(tabId);
      if (s) protokollieren(s.seite, { t: Date.now(), status, cmp: msg.cmp });
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
        if (muster.length) return s.status === 'unbekannt' ? s : setzeStatus(s, 'unbekannt', 'Banner-Text erkannt, aber keine Regel – nichts geklickt');
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

async function eigeneNachricht(msg, sender) {
  const tabId = sender.tab?.id;
  const seitenUrl = sender.tab?.url || sender.url || '';
  switch (msg.type) {
    case 'ch:pur': {
      const prefs = await laden();
      const aktion = istAus(prefs, seitenUrl) ? 'aus' : prefs.pur;
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
