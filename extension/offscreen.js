// Offscreen Document: hier läuft Gemini Nano (Prompt API ist im Service Worker nicht verfügbar).
import { verfuegbarkeit, sitzung, fragen } from './lib/nano.js';
import { SYSTEM, SCHEMA, eingabe, regelEinordnung } from './lib/ki.js';

// msg.attrappe: nur automatische Tests – Modell-Attrappe, die wie die festen Regeln einordnet.
// (chrome.storage gibt es im Offscreen Document nicht, deshalb kommt der Schalter vom Service Worker.)
async function einordnen(banner, attrappe) {
  if (attrappe) {
    const e = regelEinordnung(banner);
    return { ...e, zusammenfassung: 'Attrappe: Statistik und Werbung.', zwecke: ['statistik', 'werbung'] };
  }
  const s = await sitzung(SYSTEM);
  try {
    return await fragen(s, eingabe(banner), SCHEMA);
  } finally {
    s.destroy();
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, antworten) => {
  if (msg?.target !== 'offscreen') return false;
  (async () => {
    if (msg.type === 'ping') return true;
    if (msg.type === 'kiStatus') return msg.attrappe ? 'available' : verfuegbarkeit();
    if (msg.type === 'kiEinordnen') {
      const start = Date.now();
      try {
        return { ok: true, einordnung: await einordnen(msg.banner, msg.attrappe), ms: Date.now() - start };
      } catch (e) {
        return { ok: false, fehler: String(e?.message || e) };
      }
    }
    return null;
  })().then(antworten, (e) => antworten({ ok: false, fehler: String(e?.message || e) }));
  return true;
});
