// Chromes eingebautes Sprachmodell (Gemini Nano, Prompt API „LanguageModel“), falls vorhanden.
// Läuft lokal im Browser; Chrome lädt das Modell selbst herunter. Fehlt es (zu schwacher Rechner,
// zu wenig Speicher, ältere Chrome-Version), arbeitet der Cookie-Helfer mit festen Regeln weiter.
// Wird im Offscreen Document und auf der Vorgaben-Seite verwendet (wie lib/nano.js bei Ruhepol).

const SPRACHEN = [['de'], ['en']]; // Deutsch bevorzugt; ältere Modelle kennen nur Englisch

const api = () => (typeof globalThis.LanguageModel !== 'undefined' ? globalThis.LanguageModel : null);
const optionen = (s) => ({ expectedInputs: [{ type: 'text', languages: s }], expectedOutputs: [{ type: 'text', languages: s }] });

/** 'unavailable' | 'downloadable' | 'downloading' | 'available' */
export async function verfuegbarkeit() {
  const LM = api();
  if (!LM) return 'unavailable';
  for (const s of SPRACHEN) {
    try {
      const a = await LM.availability(optionen(s));
      if (a !== 'unavailable') return a;
    } catch {
      // Sprache nicht unterstützt: nächste probieren
    }
  }
  return 'unavailable';
}

export async function sitzung(system, monitor) {
  const LM = api();
  if (!LM) throw new Error('nicht verfügbar');
  let fehler = null;
  for (const s of SPRACHEN) {
    try {
      return await LM.create({ ...optionen(s), initialPrompts: [{ role: 'system', content: system }], monitor });
    } catch (e) {
      fehler = e;
    }
  }
  throw fehler || new Error('nicht verfügbar');
}

export function json(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  return JSON.parse(m ? m[0] : text);
}

// Eine Anfrage mit Zeitgrenze: Gemini Nano bleibt bei festem Antwortschema gelegentlich hängen
export async function fragen(sitzungVorlage, text, schema, ms = 30000) {
  const s = await sitzungVorlage.clone(); // jedes Banner für sich, ohne Verlauf
  const abbruch = new AbortController();
  const timer = setTimeout(() => abbruch.abort(), ms);
  try {
    return json(await s.prompt(text, { responseConstraint: schema, signal: abbruch.signal }));
  } catch (e) {
    if (abbruch.signal.aborted) throw new Error(`keine Antwort nach ${Math.round(ms / 1000)} s`);
    throw e;
  } finally {
    clearTimeout(timer);
    s.destroy();
  }
}
