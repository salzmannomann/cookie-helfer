// Erzeugt messung/ergebnisse/bericht.md aus den Messergebnissen.
// Auch einzeln aufrufbar: node messung/bericht.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// TCF-Zwecke, die nach den Vorgaben erlaubt sind: nur 1 (Speichern/Zugriff auf dem Gerät).
// Alles andere (Werbung, Profile, Messung, Marktforschung, Produktentwicklung) = nein,
// berechtigtes Interesse = alle aus.
const ERLAUBTE_ZWECKE = new Set([1]);

export function tcfPruefen(t) {
  if (!t || t.fehler) return null;
  if (t.eventStatus === 'cmpuishown') return { ok: null, text: 'noch keine Entscheidung' };
  const zuViel = t.zwecke.filter((z) => !ERLAUBTE_ZWECKE.has(z));
  const probleme = [];
  if (zuViel.length) probleme.push(`Zustimmung Zweck ${zuViel.join(',')}`);
  if (t.berechtigtesInteresse.length) probleme.push(`berecht. Interesse ${t.berechtigtesInteresse.join(',')}`);
  if (t.partnerZustimmung) probleme.push(`${t.partnerZustimmung} Partner`);
  return probleme.length ? { ok: false, text: probleme.join('; ') } : { ok: true, text: 'passt' };
}

const tcfKurz = (t) => {
  if (!t) return '–';
  if (t.fehler) return t.fehler;
  if (t.gdprApplies === false) return 'DSGVO gilt nicht (laut CMP)';
  const p = tcfPruefen(t);
  return p ? (p.ok === false ? `⚠ ${p.text}` : p.text) : '–';
};

export function bericht(meta, ergebnisse) {
  const n = ergebnisse.length;
  const zaehle = (f) => ergebnisse.filter(f).length;
  const nachErgebnis = {};
  for (const r of ergebnisse) nachErgebnis[r.ergebnis] = (nachErgebnis[r.ergebnis] || 0) + 1;
  const anbieter = {};
  for (const r of ergebnisse) {
    const a = r.popup[0] || r.erkannt[0];
    if (a) anbieter[a] = (anbieter[a] || 0) + 1;
  }
  const pur = ergebnisse.filter((r) => r.pur);
  const rest = ergebnisse.filter((r) => ['unbekanntes Banner', 'evtl. Banner (nur Heuristik)', 'Ablehnen fehlgeschlagen', 'Banner gefunden, kein Ergebnis'].includes(r.ergebnis));

  let md = `# Messung vorab: Cookie-Banner auf ${n} Seiten\n\n`;
  md += `Stand: ${meta.datum.slice(0, 16).replace('T', ' ')} UTC · autoconsent ${meta.autoconsent} (${meta.regeln} Regeln) · Standort der Messung: **${meta.standort}**\n\n`;
  md += `Aufruf jeweils der Startseite, frischer Browser ohne Cookies, Sprache de-AT, Zeitzone Wien. `;
  md += `autoconsent mit „Ablehnen“ (opt-out), nur feste Regeln; die eingebaute Heuristik von autoconsent nur zum Erkennen, nicht zum Klicken.\n\n`;

  md += `## Zusammenfassung\n\n| Ergebnis | Seiten |\n|---|---:|\n`;
  for (const [k, v] of Object.entries(nachErgebnis).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;
  md += `\n- „Zustimmen oder bezahlen“ erkannt: **${pur.length}** (${pur.map((r) => r.name).join(', ') || '–'})\n`;
  md += `- TCF-Schnittstelle vorhanden: **${zaehle((r) => r.tcfNachher && !r.tcfNachher.fehler)}**; `;
  md += `nach dem Klick passend zu den Vorgaben: **${zaehle((r) => tcfPruefen(r.tcfNachher)?.ok === true)}**, `;
  md += `mit Abweichung: **${zaehle((r) => tcfPruefen(r.tcfNachher)?.ok === false)}**\n`;
  md += `- Übrig für die KI (unbekannt / fehlgeschlagen): **${rest.length}**\n\n`;

  md += `### Banner-Anbieter\n\n| Anbieter (autoconsent-Regel) | Seiten |\n|---|---:|\n`;
  for (const [k, v] of Object.entries(anbieter).sort((a, b) => b[1] - a[1])) md += `| ${k} | ${v} |\n`;

  md += `\n## Alle Seiten\n\n| Seite | Gruppe | Anbieter | Ergebnis | Zustimmen o. bezahlen | TCF nach dem Klick |\n|---|---|---|---|---|---|\n`;
  for (const r of ergebnisse) {
    md += `| ${r.name} | ${r.gruppe} | ${r.popup.join(', ') || r.erkannt.join(', ') || '–'} | ${r.ergebnis} | ${r.pur ? `ja („${r.pur.treffer}“)` : ''} | ${tcfKurz(r.tcfNachher)} |\n`;
  }

  if (rest.length) {
    md += `\n## Was für die KI übrig bleibt\n\n`;
    for (const r of rest) {
      md += `**${r.name}** – ${r.ergebnis}${r.heuristik.length ? ` (Heuristik: ${r.heuristik.length} Muster)` : ''}\n`;
      if (r.knoepfe.length) md += `  Knöpfe: ${r.knoepfe.map((k) => `„${k}“`).join(', ')}\n`;
      if (r.bannertext) md += `  > ${r.bannertext.replace(/\s+/g, ' ').slice(0, 220)}…\n`;
      md += `\n`;
    }
  }
  return md;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ergebnisse');
  const { meta, ergebnisse } = JSON.parse(fs.readFileSync(path.join(dir, 'ergebnis.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'bericht.md'), bericht(meta, ergebnisse));
  console.log('bericht.md geschrieben');
}
