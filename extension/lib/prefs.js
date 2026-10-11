// Vorgaben (siehe docs/vorgaben.md) + Bereinigung gespeicherter Werte.
// Wird von Service Worker, Popup und Optionen verwendet.

export const STANDARD = Object.freeze({
  aktiv: true,
  // „Zustimmen oder bezahlen“: 'zustimmen' (nie bezahlen) oder 'nichts' (selbst entscheiden)
  pur: 'zustimmen',
  // Ausnahmen je Seite: { 'derstandard.at': 'aus' }
  ausnahmen: {},
});

const PUR_WERTE = ['zustimmen', 'nichts'];
const AUSNAHME_WERTE = ['aus'];

export function bereinigen(roh) {
  const p = { ...STANDARD, ausnahmen: {} };
  if (!roh || typeof roh !== 'object') return p;
  if (typeof roh.aktiv === 'boolean') p.aktiv = roh.aktiv;
  if (PUR_WERTE.includes(roh.pur)) p.pur = roh.pur;
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

export async function laden() {
  const { prefs } = await chrome.storage.local.get('prefs');
  return bereinigen(prefs);
}

export async function speichern(prefs) {
  const sauber = bereinigen(prefs);
  await chrome.storage.local.set({ prefs: sauber });
  return sauber;
}
