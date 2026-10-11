// Testseiten: jeder Klick wird in window.geklickt (Hauptseite) festgehalten
window.geklickt = [];
window.addEventListener('message', (e) => {
  if (e.data && e.data.geklickt) {
    window.geklickt.push(e.data.geklickt);
    document.querySelectorAll('[id^=sp_message_container_]').forEach((c) => c.remove());
  }
});
function merken(el, wert, schliessen) {
  el.addEventListener('click', (ev) => {
    ev.preventDefault();
    window.geklickt.push(wert);
    if (schliessen) document.querySelector(schliessen)?.remove();
  });
}

// Nachgebaute TCF-Schnittstelle (__tcfapi): tcfSetzen() meldet eine Entscheidung an alle Zuhörer
(() => {
  const zuhoerer = [];
  let aktuell = null;
  window.__tcfapi = (befehl, version, cb) => {
    if (befehl === 'addEventListener') {
      zuhoerer.push(cb);
      if (aktuell) cb(aktuell, true);
    } else if (befehl === 'getTCData') cb(aktuell, !!aktuell);
  };
  const objekt = (liste) => Object.fromEntries((liste || []).map((n) => [n, true]));
  window.tcfSetzen = ({ zwecke = [], bi = [], partner = 0 } = {}) => {
    aktuell = {
      eventStatus: 'useractioncomplete',
      cmpId: 28,
      gdprApplies: true,
      purpose: { consents: objekt(zwecke), legitimateInterests: objekt(bi) },
      vendor: { consents: objekt(Array.from({ length: partner }, (_, i) => i + 1)), legitimateInterests: {} },
      specialFeatureOptins: {},
      publisher: { consents: {}, legitimateInterests: {} },
    };
    zuhoerer.forEach((cb) => cb(aktuell, true));
  };
})();
