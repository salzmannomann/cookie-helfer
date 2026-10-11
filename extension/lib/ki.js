// Lokale KI für unbekannte Banner: Prompt, Antwortschema und die festen Regeln,
// nach denen aus der Einordnung ein Vorschlag wird.
//
// Das Modell ordnet nur ein (welcher Knopf ist was, was will die Seite). Ob ein Knopf
// vorgeschlagen wird, entscheiden die Regeln unten – nie das Modell allein.

export const ARTEN = [
  'ablehnen',
  'nur_notwendige',
  'einstellungen',
  'auswahl_speichern',
  'alle_akzeptieren',
  'schliessen',
  'abo_oder_kauf',
  'anmelden',
  'sonstiges',
];

export const ZWECK_ARTEN = ['funktional', 'statistik', 'werbung', 'personalisierung', 'partner', 'social_media'];

export const SCHEMA = {
  type: 'object',
  properties: {
    zusammenfassung: { type: 'string' },
    zwecke: { type: 'array', items: { type: 'string', enum: ZWECK_ARTEN } },
    partner: { type: 'integer' },
    zustimmenOderBezahlen: { type: 'boolean' },
    knoepfe: {
      type: 'array',
      items: {
        type: 'object',
        properties: { nr: { type: 'integer' }, art: { type: 'string', enum: ARTEN } },
        required: ['nr', 'art'],
      },
    },
  },
  required: ['zusammenfassung', 'zwecke', 'partner', 'zustimmenOderBezahlen', 'knoepfe'],
};

export const SYSTEM = [
  'Du hilfst einer Browser-Erweiterung, Cookie-Banner zu verstehen.',
  'Du bekommst den Text eines Cookie-Banners und eine nummerierte Liste seiner Knöpfe.',
  'Ordne jeden Knopf genau einer Art zu:',
  '- ablehnen: lehnt alle nicht notwendigen Cookies ab (z. B. "Ablehnen", "Alle ablehnen", "Nicht technische Cookies ablehnen")',
  '- nur_notwendige: erlaubt nur notwendige Cookies (z. B. "Nur notwendige", "Nur essentielle Cookies akzeptieren")',
  '- einstellungen: öffnet Einstellungen oder Details',
  '- auswahl_speichern: speichert die aktuelle Auswahl',
  '- alle_akzeptieren: stimmt allem zu (z. B. "Alle akzeptieren", "OK", "Weiter", "Verstanden", "Einverstanden")',
  '- schliessen: schließt das Banner ohne klare Entscheidung (z. B. "X")',
  '- abo_oder_kauf: Abo, Bezahlen, Kaufen, werbefreie Version',
  '- anmelden: Anmelden, Login, Registrieren',
  '- sonstiges: alles andere (Links zur Datenschutzerklärung, Navigation)',
  'Ein Knopf, dessen Wirkung unklar ist ("Weiter", "OK"), ist nie "ablehnen".',
  'Fasse in "zusammenfassung" in einem kurzen deutschen Satz zusammen, wofür die Seite Cookies will.',
  'Gib in "zwecke" die genannten Zwecke an, in "partner" die genannte Anzahl Partner (0 wenn keine Zahl genannt),',
  'und in "zustimmenOderBezahlen", ob man nur zustimmen oder ein Abo abschließen kann.',
  'Antworte nur mit JSON.',
].join('\n');

export function eingabe(banner) {
  const knoepfe = banner.knoepfe.map((k) => `${k.nr}: ${k.text}`).join('\n');
  return `Banner-Text:\n${banner.text.slice(0, 1500)}\n\nKnöpfe:\n${knoepfe}`;
}

// --- feste Regeln ---

const VERBOTEN = /abo\b|abos\b|abonn|kauf|bezahl|zahlen|€|\beur\b|kostenpflichtig|anmeld|login|einlogg|registr|subscribe|\bpay\b|sign.?in/i;
const ZUSTIMMEN = /akzept|zustimm|einverstanden|annehm|erlaub|einwillig|accept|agree|allow|\bok\b|weiter|verstanden|got it/i;
const NUR_NOETIG = /notwendig|essen[tz]iell|erforderlich|necessary|essential|nicht.technisch|technisch (nötig|notwendig)/i;
const ABLEHNEN = /ablehn|verweiger|widersprech|refuse|reject|decline|deny|nicht zustimmen|ohne zustimmung|nicht akzeptieren/i;
const ALLE = /\balle[ns]?\b|\ball\b/i;

// Ist der Knopftext für sich genommen eindeutig ein „Ablehnen“ bzw. „Nur Notwendige“?
export function textSicher(text) {
  const t = String(text || '').trim();
  if (!t || t.length > 60 || VERBOTEN.test(t)) return false;
  if (ABLEHNEN.test(t)) return !(ZUSTIMMEN.test(t) && !/ablehn|refuse|reject|decline/i.test(t));
  // „Notwendige Cookies“ allein kann ein Info-Link sein: „nur“ oder ein Handlungswort muss dabei sein
  if (NUR_NOETIG.test(t) && /^nur\b|\bonly\b|zulassen|erlauben|akzept|annehm|speichern|verwenden|fortfahren|weiter mit|allow|accept|use|continue/i.test(t))
    return !(ALLE.test(t) && !/ablehn|reject/i.test(t));
  return false;
}

// Einordnung ohne Modell (Fallback, wenn Gemini Nano fehlt)
export function regelEinordnung(banner) {
  return {
    zusammenfassung: '',
    zwecke: [],
    partner: 0,
    zustimmenOderBezahlen: /\bpur\b|abo\b|abonn|werbefrei|contentpass/i.test(banner.text),
    knoepfe: banner.knoepfe.map((k) => ({
      nr: k.nr,
      art: VERBOTEN.test(k.text)
        ? 'abo_oder_kauf'
        : ABLEHNEN.test(k.text) && textSicher(k.text)
          ? 'ablehnen'
          : NUR_NOETIG.test(k.text) && textSicher(k.text)
            ? 'nur_notwendige'
            : ZUSTIMMEN.test(k.text)
              ? 'alle_akzeptieren'
              : /einstell|optionen|anpassen|details|settings|customi[sz]e|auswahl/i.test(k.text)
                ? 'einstellungen'
                : 'sonstiges',
    })),
  };
}

// Bereinigt die Modellantwort (nur bekannte Werte, nur vorhandene Knöpfe)
export function bereinigen(antwort, banner) {
  const nrs = new Set(banner.knoepfe.map((k) => k.nr));
  const a = antwort && typeof antwort === 'object' ? antwort : {};
  return {
    zusammenfassung: String(a.zusammenfassung || '').slice(0, 300),
    zwecke: [...new Set((Array.isArray(a.zwecke) ? a.zwecke : []).filter((z) => ZWECK_ARTEN.includes(z)))],
    partner: Number.isInteger(a.partner) && a.partner > 0 && a.partner < 10000 ? a.partner : 0,
    zustimmenOderBezahlen: a.zustimmenOderBezahlen === true,
    knoepfe: (Array.isArray(a.knoepfe) ? a.knoepfe : []).filter((k) => k && nrs.has(k.nr) && ARTEN.includes(k.art)),
  };
}

// Reiner Hinweis („Diese Website verwendet ausschließlich technisch notwendige Cookies“ + „Verstanden“):
// nichts abzulehnen, Wegklicken ist harmlos. Nur wenn der Text keine Zwecke außer „notwendig“ nennt.
const NUR_HINWEIS = /(ausschlie(ß|ss)lich|nur)\s+(technisch\s+)?(notwendig|erforderlich|essen[tz]iell)|only (strictly )?necessary/i;
const ANDERE_ZWECKE = /einwillig|zustimm|partner|werb|marketing|analy|statistik|personalis|tracking|drittanbieter|third.part|consent/i;
const QUITTIEREN = /^(verstanden|ok|okay|alles klar|schlie(ß|ss)en|hinweis schlie(ß|ss)en|got it|close|×|x)$/i;

export function istNurHinweis(banner) {
  return NUR_HINWEIS.test(banner.text) && !ANDERE_ZWECKE.test(banner.text.replace(/kein(e|en)?\s+\w*tracking/gi, ''));
}

// Darf dieser Knopf (wieder) geklickt werden? Für gemerkte Knöpfe beim nächsten Besuch.
export function sicherFuer(banner, text) {
  return textSicher(text) || (istNurHinweis(banner) && QUITTIEREN.test(String(text).trim()));
}

// Vorschlag: Welcher Knopf, entscheiden die festen Regeln (gemessen 0.4.2: Regeln 36/36 richtig,
// Gemini Nano 27/36 und 6 Irrtümer). Die Einordnung des Modells darf nur bremsen: Hält es das Banner
// für „Zustimmen oder bezahlen“, gibt es keinen Vorschlag. Ohne Modell: einordnung = regelEinordnung.
export function vorschlag(einordnung, banner) {
  const regeln = regelEinordnung(banner);
  if (einordnung?.zustimmenOderBezahlen || regeln.zustimmenOderBezahlen) return null;
  const art = new Map(regeln.knoepfe.map((k) => [k.nr, k.art]));
  const passend = banner.knoepfe.filter((k) => ['ablehnen', 'nur_notwendige'].includes(art.get(k.nr)) && textSicher(k.text));
  if (!passend.length) {
    // nur ein Knopf mit Wirkung, Banner nennt nur notwendige Cookies → Hinweis wegklicken
    const wirksam = banner.knoepfe.filter((k) => art.get(k.nr) !== 'sonstiges');
    if (istNurHinweis(banner) && wirksam.length === 1 && QUITTIEREN.test(wirksam[0].text.trim()))
      return { nr: wirksam[0].nr, text: wirksam[0].text, hinweis: true };
    return null;
  }
  passend.sort((a, b) => (art.get(a.nr) === 'ablehnen' ? 0 : 1) - (art.get(b.nr) === 'ablehnen' ? 0 : 1));
  return { nr: passend[0].nr, text: passend[0].text };
}

// --- Messung (Vorgaben → KI-Messung): Einordnung für alle Messfälle, Vergleich mit dem richtigen Knopf ---
// einordnen(banner) liefert die (unbereinigte) Einordnung – Gemini Nano oder regelEinordnung.
// Fehlgriff = ein falscher Knopf wäre vorgeschlagen worden (darf nie vorkommen).
// Modellirrtum = das Modell hält einen Zustimmen-/Abo-Knopf für „ablehnen“ (die Regeln fangen das ab).
export async function messen(faelle, einordnen, fortschritt = () => {}) {
  const ergebnisse = [];
  for (const [i, f] of faelle.entries()) {
    const start = Date.now();
    let e;
    let fehler = null;
    try {
      e = bereinigen(await einordnen(f), f);
    } catch (err) {
      fehler = String(err?.message || err);
      e = bereinigen({}, f);
    }
    const v = vorschlag(e, f);
    const art = new Map(e.knoepfe.map((k) => [k.nr, k.art]));
    const irrtuemer = f.knoepfe
      .filter((k) => ['ablehnen', 'nur_notwendige'].includes(art.get(k.nr)) && k.text !== f.erwartet && !textSicher(k.text))
      .map((k) => k.text);
    const vorgeschlagen = v ? v.text : null;
    ergebnisse.push({
      seite: f.seite,
      erwartet: f.erwartet,
      vorgeschlagen,
      ergebnis: vorgeschlagen === f.erwartet ? 'treffer' : vorgeschlagen ? 'fehlgriff' : 'verpasst',
      irrtuemer,
      fehler,
      ms: Date.now() - start,
    });
    fortschritt(i + 1, faelle.length);
  }
  const zaehle = (x) => ergebnisse.filter((r) => r.ergebnis === x).length;
  return {
    faelle: ergebnisse.length,
    treffer: zaehle('treffer'),
    verpasst: zaehle('verpasst'),
    fehlgriffe: zaehle('fehlgriff'),
    modellirrtuemer: ergebnisse.reduce((n, r) => n + r.irrtuemer.length, 0),
    fehler: ergebnisse.filter((r) => r.fehler).length,
    msSchnitt: Math.round(ergebnisse.reduce((n, r) => n + r.ms, 0) / Math.max(1, ergebnisse.length)),
    ergebnisse,
  };
}
