// Vorgaben (siehe docs/vorgaben.md) + Bereinigung gespeicherter Werte.
// Wird von Service Worker, Popup und Optionen verwendet.

export const STANDARD = Object.freeze({
  aktiv: true,
  // „Zustimmen oder bezahlen“: 'zustimmen' (nie bezahlen) oder 'nichts' (selbst entscheiden)
  pur: 'zustimmen',
  // Unbekannte Banner: 'vorschlag' (ich bestätige), 'selbst' (erst nach fehlerfreier KI-Messung) oder 'aus'
  ki: 'vorschlag',
  // Ausnahmen je Seite: { 'derstandard.at': 'aus' }
  ausnahmen: {},
});

const PUR_WERTE = ['zustimmen', 'nichts'];
const AUSNAHME_WERTE = ['aus'];
const KI_WERTE = ['vorschlag', 'selbst', 'aus'];

export function bereinigen(roh) {
  const p = { ...STANDARD, ausnahmen: {} };
  if (!roh || typeof roh !== 'object') return p;
  if (typeof roh.aktiv === 'boolean') p.aktiv = roh.aktiv;
  if (PUR_WERTE.includes(roh.pur)) p.pur = roh.pur;
  if (KI_WERTE.includes(roh.ki)) p.ki = roh.ki;
  if (roh.ausnahmen && typeof roh.ausnahmen === 'object') {
    for (const [domain, wert] of Object.entries(roh.ausnahmen)) {
      const d = seitenName(domain);
      if (d && AUSNAHME_WERTE.includes(wert)) p.ausnahmen[d] = wert;
    }
  }
  return p;
}

// „www.derstandard.at“ / URL → „derstandard.at“ (Ausnahmen gelten für die ganze Seite)
export function seitenName(urlOderHost) {
  if (!urlOderHost || typeof urlOderHost !== 'string') return '';
  let host = urlOderHost.trim().toLowerCase();
  try {
    if (host.includes('/')) host = new URL(host).hostname;
  } catch {
    return '';
  }
  host = host.replace(/^www\d?\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(host) ? host : '';
}

export function istAus(prefs, url) {
  if (!prefs.aktiv) return true;
  const name = seitenName(url);
  if (!name) return false;
  // auch Unterdomains: Ausnahme „derstandard.at“ gilt für „apps.derstandard.at“
  return Object.entries(prefs.ausnahmen).some(([d, w]) => w === 'aus' && (name === d || name.endsWith('.' + d)));
}

// Vorgaben und gemerkte Knöpfe liegen in chrome.storage.sync und werden so über das Google-Konto
// auf alle Rechner mit dieser Erweiterung abgeglichen (feste ID über „key“ im Manifest).
// Protokoll und Messungen bleiben lokal (storage.local).
const MAX_AUSNAHMEN = 300; // storage.sync: höchstens 8 KB je Eintrag
const MAX_GELERNT = 150;

export async function laden() {
  const { prefs } = await chrome.storage.sync.get('prefs');
  if (prefs) return bereinigen(prefs);
  // einmalige Übernahme aus älteren Versionen (lokal gespeichert)
  const { prefs: alt } = await chrome.storage.local.get('prefs');
  if (alt) return speichern(alt);
  return bereinigen(null);
}

export async function speichern(prefs) {
  const sauber = bereinigen(prefs);
  const seiten = Object.keys(sauber.ausnahmen);
  if (seiten.length > MAX_AUSNAHMEN) for (const s of seiten.slice(0, seiten.length - MAX_AUSNAHMEN)) delete sauber.ausnahmen[s];
  await chrome.storage.sync.set({ prefs: sauber });
  return sauber;
}

// Gemerkte Knöpfe: { 'oebb.at': ['Nicht technische Cookies ablehnen'] }
export function gelerntBereinigen(roh) {
  const g = {};
  if (!roh || typeof roh !== 'object') return g;
  for (const [seite, texte] of Object.entries(roh)) {
    const d = seitenName(seite);
    if (!d || !Array.isArray(texte)) continue;
    const t = texte.filter((x) => typeof x === 'string' && x.length <= 80).slice(-5);
    if (t.length) g[d] = t;
  }
  const seiten = Object.keys(g);
  for (const s of seiten.slice(0, Math.max(0, seiten.length - MAX_GELERNT))) delete g[s];
  return g;
}

export async function gelerntLaden() {
  const { gelernt } = await chrome.storage.sync.get('gelernt');
  if (gelernt) return gelerntBereinigen(gelernt);
  const { gelernt: alt } = await chrome.storage.local.get('gelernt');
  return alt ? gelerntSpeichern(alt) : {};
}

export async function gelerntSpeichern(gelernt) {
  const sauber = gelerntBereinigen(gelernt);
  await chrome.storage.sync.set({ gelernt: sauber });
  return sauber;
}
