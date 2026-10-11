// TCF-Zwecke (IAB TCF 2.2) und Abgleich mit den Vorgaben.

export const ZWECKE = {
  1: 'Speichern/Auslesen auf dem Gerät',
  2: 'einfache Werbung',
  3: 'Werbeprofile',
  4: 'personalisierte Werbung',
  5: 'Inhaltsprofile',
  6: 'personalisierte Inhalte',
  7: 'Werbemessung',
  8: 'Inhaltsmessung',
  9: 'Marktforschung',
  10: 'Produktentwicklung',
  11: 'begrenzte Daten für Inhalte',
};

// Laut Vorgabe nach dem Ablehnen erlaubt: nur Zweck 1 (technisch nötig, z. B. um die Entscheidung zu speichern)
const ERLAUBT = new Set([1]);

const namen = (liste) => liste.map((z) => ZWECKE[z] || `Zweck ${z}`).join(', ');

export function abweichungen(t) {
  const abw = [];
  const zuViel = t.zwecke.filter((z) => !ERLAUBT.has(z));
  if (zuViel.length) abw.push(`Zustimmung: ${namen(zuViel)}`);
  if (t.bi.length) abw.push(`berechtigtes Interesse: ${namen(t.bi)}`);
  // Partner-Zustimmung ohne erlaubten Zweck ist wirkungslos (z. B. sn.at nach „Alle ablehnen“)
  if (t.partner && zuViel.length) abw.push(`${t.partner} Partner mit Zustimmung`);
  if (t.besondere.length) abw.push('genaue Standortdaten/Geräte-Scan');
  return abw;
}

export function tcfKurz(t) {
  if (!t.gdpr) return 'DSGVO gilt laut Seite nicht';
  const teile = [];
  teile.push(t.zwecke.length ? `Zustimmung ${t.zwecke.length === 11 ? 'alle 11 Zwecke' : `Zwecke ${t.zwecke.join(',')}`}` : 'keine Zustimmung');
  if (t.bi.length) teile.push(`berecht. Interesse ${t.bi.join(',')}`);
  if (t.partner) teile.push(`${t.partner} Partner`);
  return teile.join(' · ');
}
