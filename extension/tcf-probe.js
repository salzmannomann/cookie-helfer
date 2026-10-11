// Läuft im Seitenkontext (world: MAIN, nur Hauptframe), weil __tcfapi nur dort erreichbar ist.
// Hört auf TCF-Ereignisse und meldet eine Zusammenfassung an tcf-bruecke.js (isolierte Welt).
// Liest nur – ändert nichts an der Einwilligung.
(() => {
  const SIGNAL = 'cookie-helfer:tcf';
  let versuche = 0;

  const an = (o) =>
    Object.entries(o || {})
      .filter(([, v]) => v === true)
      .map(([k]) => Number(k))
      .filter((n) => Number.isInteger(n));

  function zusammenfassen(d) {
    return {
      status: d.eventStatus,
      cmpId: d.cmpId,
      gdpr: d.gdprApplies,
      zwecke: an(d.purpose?.consents),
      bi: an(d.purpose?.legitimateInterests),
      besondere: an(d.specialFeatureOptins),
      partner: an(d.vendor?.consents).length,
      partnerBi: an(d.vendor?.legitimateInterests).length,
      publisherZwecke: an(d.publisher?.consents),
      publisherBi: an(d.publisher?.legitimateInterests),
    };
  }

  function verbinden() {
    if (typeof window.__tcfapi !== 'function') {
      if (++versuche < 60) setTimeout(verbinden, 500); // bis 30 s nach dem Laden
      return;
    }
    try {
      window.__tcfapi('addEventListener', 2, (d, ok) => {
        if (!ok || !d) return;
        if (d.eventStatus !== 'tcloaded' && d.eventStatus !== 'useractioncomplete') return;
        window.postMessage({ [SIGNAL]: zusammenfassen(d) }, '*');
      });
    } catch {
      // fehlerhafte CMP – ignorieren
    }
  }
  verbinden();
})();
