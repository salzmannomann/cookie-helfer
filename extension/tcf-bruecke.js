// Isolierte Welt, Hauptframe: reicht die TCF-Zusammenfassung von tcf-probe.js an den Service Worker weiter.
(() => {
  const SIGNAL = 'cookie-helfer:tcf';
  const zahlen = (a) => (Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n > 0 && n < 100).slice(0, 30) : []);
  const zahl = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data && e.data[SIGNAL];
    if (!d || typeof d !== 'object') return;
    const daten = {
      status: d.status === 'useractioncomplete' ? 'useractioncomplete' : 'tcloaded',
      cmpId: zahl(d.cmpId),
      gdpr: d.gdpr !== false,
      zwecke: zahlen(d.zwecke),
      bi: zahlen(d.bi),
      besondere: zahlen(d.besondere),
      partner: zahl(d.partner),
      partnerBi: zahl(d.partnerBi),
      publisherZwecke: zahlen(d.publisherZwecke),
      publisherBi: zahlen(d.publisherBi),
    };
    chrome.runtime.sendMessage({ type: 'ch:tcf', daten }).catch(() => {});
  });
})();
