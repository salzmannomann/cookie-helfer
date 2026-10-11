// „Zustimmen oder bezahlen“ (Pur-Abo, contentpass …)
//
// autoconsent lässt solche Banner bewusst offen, weil es dort kein „Ablehnen“ gibt.
// Nach der Vorgabe wird hier zugestimmt – nie bezahlt, nie ein Abo- oder Login-Knopf.
// Geklickt wird nur der Zustimmen-Knopf, den der jeweilige Anbieter eindeutig
// kennzeichnet (Klasse/ID), und zusätzlich nur, wenn sein Text nach Zustimmen klingt
// und nichts von Abo/Bezahlen enthält.
(() => {
  if (window.__cookieHelferPur) return;
  window.__cookieHelferPur = true;

  const ZUSTIMMEN = /zustimm|einverstanden|akzeptier|annehm|einwillig|mit werbung|accept|agree|^ok$/i;
  const VERBOTEN = /abo\b|abos\b|abonn|kauf|bezahl|zahlen|€|\beur\b|\bpur\b|kostenpflichtig|anmeld|login|einlogg|registr|testen|subscribe|\bpay\b|sign.?in/i;
  const PUR_TEXT = /\bpur\b|abo\b|abonn|werbefrei|ohne werbung|contentpass|bezahl/i;

  const sichtbar = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  // sucht auch in offenen Shadow Roots
  const finde = (sel) => {
    const direkt = document.querySelector(sel);
    if (direkt) return direkt;
    for (const el of document.querySelectorAll('*')) {
      const t = el.shadowRoot && el.shadowRoot.querySelector(sel);
      if (t) return t;
    }
    return null;
  };

  // Jeder Erkenner liefert null (nichts da) oder { art: 'pur' | 'kein-pur', knopf, grund, stabil }.
  // stabil = wie oft hintereinander (alle 0,5 s) dasselbe Ergebnis kommen muss, bevor entschieden
  // wird – Banner bauen sich schrittweise auf, ein fehlender Knopf/Text kann noch nachkommen.
  const ERKENNER = [
    {
      cmp: 'Sourcepoint',
      passt: () => /\/index\.html$/.test(location.pathname) && /[?&](message_id|consentUUID)=/.test(location.search),
      pruefen() {
        const ja = document.querySelector('.sp_choice_type_11');
        if (!sichtbar(ja)) return null;
        if (document.querySelector('.sp_choice_type_9')) return { art: 'pur', knopf: ja, grund: 'Bezahl-Knopf im Banner', stabil: 2 };
        const ablehnenMoeglich = ['.sp_choice_type_12', '.sp_choice_type_13', '.sp_choice_type_SE'].some((s) =>
          sichtbar(document.querySelector(s)),
        );
        return ablehnenMoeglich
          ? { art: 'kein-pur', stabil: 1 }
          : { art: 'pur', knopf: ja, grund: 'nur Zustimmen möglich', stabil: 6 };
      },
    },
    {
      cmp: 'consentmanager',
      passt: () => true,
      pruefen() {
        const box = document.querySelector('#cmpbox');
        if (!sichtbar(box)) return null;
        const ja = box.querySelector('.cmpboxbtnyes');
        if (!sichtbar(ja)) return null;
        if (sichtbar(box.querySelector('.cmpboxbtnno'))) return { art: 'kein-pur', stabil: 1 };
        return PUR_TEXT.test(box.innerText || '')
          ? { art: 'pur', knopf: ja, grund: 'Abo-Angebot im Banner', stabil: 2 }
          : { art: 'kein-pur', stabil: 12 };
      },
    },
    {
      // Didomi (z. B. kleinezeitung.at): nach dem Ablehnen erscheint ein Fenster mit „Pur kaufen“
      cmp: 'Didomi',
      passt: () => true,
      pruefen() {
        const box = ['#didomi-popup', '#didomi-notice'].map((s) => document.querySelector(s)).find(sichtbar);
        if (!box) return null;
        const knoepfe = [...box.querySelectorAll('button')].filter(sichtbar);
        const text = (b) => (b.innerText || b.textContent || '').trim();
        const abo = knoepfe.some((b) => VERBOTEN.test(text(b)));
        if (!abo || !PUR_TEXT.test(box.innerText || '')) return { art: 'kein-pur', stabil: 12 };
        const ja = knoepfe.find((b) => ZUSTIMMEN.test(text(b)) && !VERBOTEN.test(text(b)));
        return ja ? { art: 'pur', knopf: ja, grund: 'Pur-Angebot im Banner', stabil: 2 } : null;
      },
    },
    {
      cmp: 'contentpass',
      passt: () => true,
      pruefen() {
        const ja = finde('#cmp-btn-accept');
        if (!sichtbar(ja)) return null;
        return sichtbar(finde('#cmp-btn-signup'))
          ? { art: 'pur', knopf: ja, grund: 'Abo-Angebot im Banner', stabil: 2 }
          : { art: 'kein-pur', stabil: 12 };
      },
    },
  ];

  const senden = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

  let offen = ERKENNER.filter((e) => {
    try {
      return e.passt();
    } catch {
      return false;
    }
  });
  const serie = new Map(); // Erkenner → { schluessel, anzahl }
  let runden = 0;
  let fertig = false;

  async function behandeln(e, treffer) {
    fertig = true;
    const antwort = await senden({ type: 'ch:pur', cmp: e.cmp, grund: treffer.grund });
    if (!antwort || antwort.aktion !== 'zustimmen') return;
    const text = (treffer.knopf.innerText || treffer.knopf.textContent || '').trim().replace(/\s+/g, ' ');
    if (!ZUSTIMMEN.test(text) || VERBOTEN.test(text)) {
      senden({ type: 'ch:purErgebnis', cmp: e.cmp, erfolg: false, knopf: text, grund: 'Knopftext nicht eindeutig – nichts geklickt' });
      return;
    }
    treffer.knopf.click();
    senden({ type: 'ch:purErgebnis', cmp: e.cmp, erfolg: true, knopf: text });
  }

  function runde() {
    if (fertig || !offen.length) return;
    runden++;
    for (const e of [...offen]) {
      let r;
      try {
        r = e.pruefen();
      } catch {
        r = null;
      }
      const schluessel = r ? `${r.art}|${r.grund || ''}` : 'leer';
      const alt = serie.get(e);
      const anzahl = alt && alt.schluessel === schluessel ? alt.anzahl + 1 : 1;
      serie.set(e, { schluessel, anzahl });
      if (!r || anzahl < r.stabil) continue;
      if (r.art === 'kein-pur') offen = offen.filter((x) => x !== e);
      else return behandeln(e, r);
    }
    if (runden < 60) setTimeout(runde, 500); // höchstens 30 s nach dem Laden (Pur-Fenster kommt oft erst nach dem Ablehnen)
  }

  if (offen.length) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runde, { once: true });
    else runde();
  }
})();
