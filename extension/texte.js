// Anzeigetexte für die Status-Werte aus dem Service Worker
export const STATUS = {
  suche: ['Suche nach Banner …', ''],
  nichts: ['Kein bekanntes Banner', ''],
  gefunden: ['Banner gefunden', ''],
  abgelehnt: ['Abgelehnt', 'ok'],
  ausgeblendet: ['Banner ausgeblendet – nichts zugestimmt', 'ok'],
  'pur-zugestimmt': ['Zugestimmt (Zustimmen oder bezahlen)', 'pur'],
  'pur-offen': ['Zustimmen oder bezahlen – deine Entscheidung', 'pur'],
  fehlgeschlagen: ['Nicht erledigt', 'fehler'],
  abweichung: ['Abgelehnt – aber nicht alles', 'pur'],
  unbekannt: ['Unbekanntes Banner', ''],
  aus: ['Auf dieser Seite ausgeschaltet', ''],
};

export const zeit = (t) => new Date(t).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' });
