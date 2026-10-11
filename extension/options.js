import { laden, speichern, seitenName } from './lib/prefs.js';
import { STATUS, zeit } from './texte.js';
import { verfuegbarkeit, sitzung } from './lib/nano.js';

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
  const { gelernt = {} } = await chrome.storage.local.get('gelernt');
  const eintraege = Object.entries(gelernt).flatMap(([seite, texte]) => texte.map((text) => ({ seite, text })));
  $('gelernt').replaceChildren(
    ...(eintraege.length
      ? eintraege.map(({ seite, text }) => {
          const knopf = el('button', { textContent: 'vergessen' });
          knopf.addEventListener('click', async () => {
            const { gelernt: g = {} } = await chrome.storage.local.get('gelernt');
            g[seite] = (g[seite] || []).filter((t) => t !== text);
            if (!g[seite].length) delete g[seite];
            await chrome.storage.local.set({ gelernt: g });
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

async function zeigen() {
  await zeigeVorgaben();
  await zeigeProtokoll();
}
chrome.storage.onChanged.addListener(zeigen);
zeigen();
