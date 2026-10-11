// Unbekannte Banner (Hauptframe): Text und Knöpfe auslesen und – nur auf Auftrag aus dem
// Service Worker – einen Knopf klicken. Geklickt wird nur ein Knopf im ausgelesenen Banner,
// und nur, wenn sein Text noch genau dem bestätigten entspricht.
(() => {
  if (window.__cookieHelferKi) return;
  window.__cookieHelferKi = true;

  const CONSENT = /cookie|einwillig|zustimm|consent|datenschutz|tracking|privatsphäre|privacy/i;
  let knopfElemente = [];

  const sichtbar = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const textVon = (el) => (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ');
  const vollerText = (el) => {
    let t = el.innerText || '';
    if (el.shadowRoot) t += ' ' + (el.shadowRoot.textContent || '');
    return t.replace(/\s+/g, ' ').trim();
  };

  // alle Elemente inkl. offener Shadow Roots
  function* alle(wurzel) {
    for (const el of wurzel.querySelectorAll('*')) {
      yield el;
      if (el.shadowRoot) yield* alle(el.shadowRoot);
    }
  }

  function bannerFinden() {
    let bestes = null;
    for (const el of alle(document)) {
      let cs;
      try {
        cs = getComputedStyle(el);
      } catch {
        continue;
      }
      const fix = cs.position === 'fixed' || cs.position === 'sticky';
      const dlg = el.tagName === 'DIALOG' || el.getAttribute('role') === 'dialog' || el.getAttribute('aria-modal') === 'true';
      if (!(fix || dlg) || !sichtbar(el)) continue;
      const text = vollerText(el);
      if (text.length < 40 || !CONSENT.test(text)) continue;
      const knoepfe = knoepfeIn(el);
      if (!knoepfe.length) continue;
      // kleinstes Element, das Text und Knöpfe enthält (nicht die ganze Seite)
      if (!bestes || text.length < bestes.text.length) bestes = { el, text, knoepfe };
    }
    return bestes;
  }

  function knoepfeIn(wurzel) {
    const out = [];
    const sel = 'button, a, [role=button], input[type=button], input[type=submit]';
    const suchen = (r) => {
      r.querySelectorAll(sel).forEach((b) => {
        const t = textVon(b);
        if (t && t.length <= 80 && sichtbar(b)) out.push({ el: b, text: t });
      });
      r.querySelectorAll('*').forEach((e) => e.shadowRoot && suchen(e.shadowRoot));
    };
    suchen(wurzel);
    if (wurzel.shadowRoot) suchen(wurzel.shadowRoot);
    return out.slice(0, 25);
  }

  function lesen() {
    const b = bannerFinden();
    if (!b) return null;
    knopfElemente = b.knoepfe.map((k) => k.el);
    return { text: b.text.slice(0, 2000), knoepfe: b.knoepfe.map((k, i) => ({ nr: i + 1, text: k.text })) };
  }

  function klicken(nr, text) {
    let el = knopfElemente[nr - 1];
    if (!el || !el.isConnected || textVon(el) !== text) {
      // Banner neu aufgebaut: Knopf mit genau diesem Text im Banner suchen
      const b = bannerFinden();
      el = b?.knoepfe.find((k) => k.text === text)?.el;
    }
    if (!el || !sichtbar(el)) return { ok: false, grund: 'Knopf nicht mehr da' };
    el.click();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, antworten) => {
    if (msg?.type === 'ch:bannerLesen') {
      antworten(lesen());
      return false;
    }
    if (msg?.type === 'ch:klick') {
      antworten(klicken(msg.nr, msg.text));
      return false;
    }
    return false;
  });
})();
