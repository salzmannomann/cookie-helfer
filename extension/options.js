import { laden, speichern, seitenName, gelerntLaden, gelerntSpeichern } from './lib/prefs.js';
import { STATUS, zeit } from './texte.js';
import { verfuegbarkeit, sitzung, fragen } from './lib/nano.js';
import { SYSTEM, SCHEMA, eingabe, regelEinordnung, messen } from './lib/ki.js';

const $ = (id) => document.getElementById(id);
const el = (tag, eigenschaften = {}, ...kinder) => {
  const e = Object.assign(document.createElement(tag), eigenschaften);
  e.append(...kinder);
  return e;
};

// --- Bereiche (Navigation wie bei Ruhepol) ---
function zeigeBereich() {
  const name = location.hash.slice(1) || 'vorgaben';
  const gibt = document.getElementById(`page-${name}`) ? name : 'vorgaben';
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${gibt}`));
  document.querySelectorAll('nav a').forEach((a) => (a.dataset.page === gibt ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}
window.addEventListener('hashchange', zeigeBereich);
zeigeBereich();

let toastTimer;
function gespeichert() {
  $('gespeichert').classList.add('zeigen');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('gespeichert').classList.remove('zeigen'), 1400);
}

async function aendern(fn) {
  const p = await laden();
  fn(p);
  await speichern(p);
  gespeichert();
}

// --- Vorgaben ---
async function zeigeVorgaben() {
  const p = await laden();
  $('aktiv').checked = p.aktiv;
  document.querySelectorAll('input[name=pur]').forEach((r) => (r.checked = r.value === p.pur));
  document.querySelectorAll('input[name=ki]').forEach((r) => (r.checked = r.value === p.ki));
  // „Selbst klicken“ erst nach fehlerfreier Messung
  const { kiMessergebnis: m } = await chrome.storage.local.get('kiMessergebnis');
  const bestanden = !!m && m.fehlgriffe === 0 && m.fehler === 0;
  $('kiSelbst').disabled = !bestanden && p.ki !== 'selbst';
  $('kiSelbstKarte').style.opacity = $('kiSelbst').disabled ? 0.55 : 1;
  $('kiSelbstHinweis').textContent = bestanden
    ? `Messung vom ${zeit(m.t)}: ${m.treffer}/${m.faelle} richtig, kein Fehlgriff (${m.quelle === 'ki' ? 'Gemini Nano' : 'feste Regeln'}). Geklickt wird nur, was auch ein Vorschlag wäre.`
    : m
      ? `Letzte Messung hatte ${m.fehlgriffe} Fehlgriff(e)${m.fehler ? ` und ${m.fehler} Fehler` : ''} – selbst klicken ist gesperrt.`
      : 'Erst möglich, wenn die KI-Messung ohne Fehlgriff durchgelaufen ist (Bereich „KI-Messung“).';
  const gelernt = await gelerntLaden();
  const eintraege = Object.entries(gelernt).flatMap(([seite, texte]) => texte.map((text) => ({ seite, text })));
  $('gelernt').replaceChildren(
    ...(eintraege.length
      ? eintraege.map(({ seite, text }) => {
          const knopf = el('button', { textContent: 'vergessen' });
          knopf.addEventListener('click', async () => {
            const g = await gelerntLaden();
            g[seite] = (g[seite] || []).filter((t) => t !== text);
            if (!g[seite].length) delete g[seite];
            await gelerntSpeichern(g);
            gespeichert();
          });
          return el('li', {}, el('span', { className: 'name', textContent: seite }), el('span', { className: 'txt', textContent: `„${text}“` }), knopf);
        })
      : [el('li', { className: 'leer', textContent: 'Noch keine.' })]),
  );
  const seiten = Object.keys(p.ausnahmen).sort();
  $('ausnahmen').replaceChildren(
    ...(seiten.length
      ? seiten.map((s) => {
          const knopf = el('button', { textContent: 'wieder einschalten' });
          knopf.addEventListener('click', () => aendern((q) => delete q.ausnahmen[s]));
          return el('li', {}, el('span', { className: 'name', textContent: s }), el('span', { className: 'txt' }), knopf);
        })
      : [el('li', { className: 'leer', textContent: 'Keine – der Cookie-Helfer ist überall eingeschaltet.' })]),
  );
}

$('aktiv').addEventListener('change', (e) => aendern((p) => (p.aktiv = e.target.checked)));
document.querySelectorAll('input[name=pur]').forEach((r) => r.addEventListener('change', () => aendern((p) => (p.pur = r.value))));
document.querySelectorAll('input[name=ki]').forEach((r) => r.addEventListener('change', () => aendern((p) => (p.ki = r.value))));

// --- Lokale KI: Status und Download (braucht einen Klick, deshalb hier und nicht im Hintergrund) ---
const KI_TEXT = {
  available: 'bereit – läuft lokal auf diesem Rechner',
  downloadable: 'nicht geladen – Chrome lädt das Modell einmalig herunter (ca. 2–4 GB)',
  downloading: 'wird heruntergeladen …',
  unavailable: 'auf diesem Rechner nicht verfügbar – Vorschläge nur aus festen Regeln',
};
async function kiStatus() {
  const a = await verfuegbarkeit();
  $('kiStatus').textContent = KI_TEXT[a] || a;
  $('kiLaden').hidden = a !== 'downloadable';
}
$('kiLaden').addEventListener('click', async () => {
  $('kiLaden').disabled = true;
  try {
    const s = await sitzung('Test', (m) =>
      m.addEventListener('downloadprogress', (e) => ($('kiStatus').textContent = `wird heruntergeladen … ${Math.round(e.loaded * 100)} %`)),
    );
    s.destroy();
  } catch (e) {
    $('kiStatus').textContent = `Laden fehlgeschlagen: ${e.message}`;
  }
  $('kiLaden').disabled = false;
  kiStatus();
});
kiStatus();
$('neueAusnahme').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = seitenName($('ausnahmeSeite').value);
  if (!s) return;
  $('ausnahmeSeite').value = '';
  aendern((p) => (p.ausnahmen[s] = 'aus'));
});

// --- Protokoll ---
async function zeigeProtokoll() {
  const { protokoll = {} } = await chrome.storage.local.get('protokoll');
  const alle = Object.entries(protokoll)
    .flatMap(([seite, eintraege]) => eintraege.map((e) => ({ ...e, seite })))
    .sort((a, b) => b.t - a.t)
    .slice(0, 50);
  $('protokoll').replaceChildren(
    ...(alle.length
      ? alle.map((e) => {
          const [titel, klasse] = STATUS[e.status] || [e.status, ''];
          return el(
            'li',
            {},
            el('span', { className: `lbl ${klasse || 'leise'}`, textContent: kurz(e.status) }),
            el('span', { className: 'name', textContent: e.seite }),
            el('span', { className: 'txt', textContent: [titel, e.cmp, e.tcf].filter(Boolean).join(' · '), title: e.tcf || '' }),
            el('span', { className: 'zeit', textContent: zeit(e.t) }),
          );
        })
      : [el('li', { className: 'leer', textContent: 'Noch nichts protokolliert.' })]),
  );
}
const kurz = (s) =>
  ({ abgelehnt: 'abgelehnt', ausgeblendet: 'ausgeblendet', 'pur-zugestimmt': 'zugestimmt', 'pur-offen': 'offen', abweichung: 'nicht alles', fehlgeschlagen: 'Fehler' })[s] || s;

$('protokollLoeschen').addEventListener('click', async () => {
  await chrome.storage.local.remove('protokoll');
  gespeichert();
});

$('version').textContent = chrome.runtime.getManifest().version;

// --- Sichern / Wiederherstellen (Vorgaben, Ausnahmen, gemerkte Knöpfe) ---
$('sichern').addEventListener('click', async () => {
  const daten = { cookieHelfer: 1, version: chrome.runtime.getManifest().version, prefs: await laden(), gelernt: await gelerntLaden() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(daten, null, 1)], { type: 'application/json' }));
  const a = el('a', { href: url, download: `cookie-helfer-vorgaben-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('wiederherstellenDatei').addEventListener('change', async (e) => {
  const datei = e.target.files[0];
  e.target.value = '';
  if (!datei) return;
  try {
    const daten = JSON.parse(await datei.text());
    if (daten?.cookieHelfer !== 1) throw new Error('keine Sicherung des Cookie-Helfers');
    await speichern(daten.prefs);
    await gelerntSpeichern(daten.gelernt);
    $('sicherungStatus').textContent = 'Wiederhergestellt.';
    gespeichert();
  } catch (err) {
    $('sicherungStatus').textContent = `Nicht möglich: ${err.message}`;
  }
});

// --- KI-Messung ---
const faelle = await (await fetch('ki-faelle.json')).json();
$('faelleAnzahl').textContent = String(faelle.length);
let letzteMessung = null;

function zeigeMessung(m) {
  if (!m) return;
  letzteMessung = m;
  $('messungErgebnis').hidden = false;
  const zeile = (titel, wert, klasse, info = '') =>
    el('li', {}, el('span', {}, titel, el('small', { textContent: info })), el('span', { className: `pill ${klasse}`, textContent: wert }));
  $('messungZahlen').replaceChildren(
    zeile('Richtig', `${m.treffer} / ${m.faelle}`, 'ja', 'richtiger Knopf vorgeschlagen bzw. richtig kein Vorschlag'),
    zeile('Fehlgriffe', String(m.fehlgriffe), m.fehlgriffe ? 'nein' : 'ja', 'falscher Knopf vorgeschlagen – muss 0 sein'),
    zeile('Verpasst', String(m.verpasst), 'immer', 'richtiger Knopf da, aber kein Vorschlag (harmlos)'),
    zeile('Modellirrtümer, von den Regeln abgefangen', String(m.modellirrtuemer), 'immer', 'Modell hielt einen Zustimmen-/Abo-Knopf für „Ablehnen“'),
    zeile('Quelle', m.quelle === 'ki' ? 'Gemini Nano' : 'feste Regeln', 'immer', `${m.msSchnitt} ms je Banner${m.fehler ? ` · ${m.fehler} Fehler` : ''}`),
  );
  $('messungFaelle').replaceChildren(
    ...m.ergebnisse.map((r) =>
      el(
        'li',
        {},
        el('span', { className: `lbl ${r.ergebnis === 'treffer' ? 'ok' : r.ergebnis === 'fehlgriff' ? 'fehler' : 'pur'}`, textContent: r.ergebnis }),
        el('span', { className: 'name', textContent: r.seite }),
        el('span', {
          className: 'txt',
          textContent: `${r.vorgeschlagen ? `„${r.vorgeschlagen}“` : 'kein Vorschlag'}${r.ergebnis === 'treffer' ? '' : ` (richtig: ${r.erwartet ? `„${r.erwartet}“` : 'keiner'})`}${r.irrtuemer.length ? ` · Modell irrte bei: ${r.irrtuemer.join(', ')}` : ''}${r.fehler ? ` · Fehler: ${r.fehler}` : ''}`,
        }),
      ),
    ),
  );
}

$('messungStart').addEventListener('click', async () => {
  $('messungStart').disabled = true;
  const verfuegbar = await verfuegbarkeit();
  const mitKi = verfuegbar === 'available';
  $('messungStatus').textContent = mitKi ? 'Gemini Nano ordnet ein …' : 'Gemini Nano nicht bereit – Messung nur mit festen Regeln …';
  let s = null;
  try {
    if (mitKi) s = await sitzung(SYSTEM);
    const einordnen = mitKi ? (b) => fragen(s, eingabe(b), SCHEMA) : async (b) => regelEinordnung(b);
    const r = await messen(faelle, einordnen, (i, n) => ($('messungStatus').textContent = `${i} / ${n} … ${faelle[i]?.seite || ''}`));
    const m = { t: Date.now(), quelle: mitKi ? 'ki' : 'regeln', version: chrome.runtime.getManifest().version, ...r };
    await chrome.storage.local.set({ kiMessergebnis: m });
    // fällt die Messung durch, wird „selbst klicken“ zurückgenommen
    if (m.fehlgriffe || m.fehler) await aendern((p) => p.ki === 'selbst' && (p.ki = 'vorschlag'));
    $('messungStatus').textContent = 'fertig';
    zeigeMessung(m);
  } catch (e) {
    $('messungStatus').textContent = `Fehler: ${e.message}`;
  } finally {
    s?.destroy();
    $('messungStart').disabled = false;
  }
});

$('messungKopieren').addEventListener('click', async () => {
  if (!letzteMessung) return;
  const { ergebnisse, ...kurz } = letzteMessung;
  const text = JSON.stringify({ ...kurz, abweichungen: ergebnisse.filter((r) => r.ergebnis !== 'treffer' || r.irrtuemer.length || r.fehler) }, null, 1);
  await navigator.clipboard.writeText(text);
  $('messungStatus').textContent = 'kopiert';
});

async function zeigeAlltag() {
  const { kiMessungen = [] } = await chrome.storage.local.get('kiMessungen');
  const vorschlaege = kiMessungen.filter((e) => 'vorschlag' in e && !e.entscheidung && e.vorschlag).length;
  const zahl = (x) => kiMessungen.filter((e) => e.entscheidung === x).length;
  const zeile = (titel, wert) => el('li', {}, el('span', { textContent: titel }), el('span', { className: 'pill immer', textContent: String(wert) }));
  $('alltag').replaceChildren(
    zeile('Unbekannte Banner eingeordnet', kiMessungen.filter((e) => e.knoepfe).length),
    zeile('davon mit Vorschlag', vorschlaege),
    zeile('Vorschlag bestätigt', zahl('geklickt')),
    zeile('Vorschlag abgelehnt („Nein“)', zahl('nein')),
    zeile('selbst geklickt', zahl('selbst')),
  );
}
zeigeAlltag();
zeigeMessung((await chrome.storage.local.get('kiMessergebnis')).kiMessergebnis);

async function zeigen() {
  await zeigeVorgaben();
  await zeigeProtokoll();
  await zeigeAlltag();
}
chrome.storage.onChanged.addListener(zeigen);
zeigen();
