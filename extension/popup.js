import { laden, speichern, seitenName, istAus } from './lib/prefs.js';
import { STATUS, zeit } from './texte.js';
import { abweichungen, ZWECKE } from './lib/tcf.js';

const $ = (id) => document.getElementById(id);
const li = (text, klasse = '') => Object.assign(document.createElement('li'), { textContent: text, className: klasse });

// Tab-ID kann für Tests per ?tab= übergeben werden
const param = new URLSearchParams(location.search).get('tab');
const tab = param ? await chrome.tabs.get(Number(param)) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const seite = seitenName(tab?.url || '');

async function zeigen() {
  const prefs = await laden();
  $('aktiv').checked = prefs.aktiv;
  $('seiteAn').checked = !!seite && !istAus({ ...prefs, aktiv: true }, tab.url);
  $('seiteAn').disabled = !seite || !prefs.aktiv;

  const key = `tab:${tab.id}`;
  const s = (await chrome.storage.session.get(key))[key];
  const st = s?.status === 'suche' && Date.now() - s.start > 10000 ? 'nichts' : s?.status;
  const [titel, klasse] = STATUS[st] || ['Keine Angaben für diese Seite', ''];
  const box = $('status');
  box.className = `status ${klasse}`;
  box.replaceChildren(Object.assign(document.createElement('b'), { textContent: titel }));
  if (s?.cmp) box.append(Object.assign(document.createElement('span'), { className: 'host', textContent: `Anbieter: ${s.cmp}` }));
  if (s?.selbsttest === false) box.append(Object.assign(document.createElement('span'), { className: 'host', textContent: 'Kontrolle: Ablehnung nicht bestätigt' }));

  // TCF: was die Seite laut eigener Schnittstelle tatsächlich erlaubt hat
  const t = s?.tcf;
  $('tcf').hidden = !t;
  if (t) {
    const zeilen = [];
    if (!t.gdpr) zeilen.push(li('DSGVO gilt laut Seite nicht'));
    else if (['abgelehnt', 'ausgeblendet', 'abweichung'].includes(s.status)) {
      const abw = abweichungen(t);
      zeilen.push(...(abw.length ? abw.map((a) => li(`⚠ ${a}`, 'warn')) : [li('✓ nur Notwendiges erlaubt', 'ok')]));
    } else {
      zeilen.push(li(t.zwecke.length ? `Zustimmung: ${t.zwecke.length === 11 ? 'alle Zwecke' : t.zwecke.map((z) => ZWECKE[z]).join(', ')}` : 'keine Zustimmung'));
      if (t.bi.length) zeilen.push(li(`berechtigtes Interesse: ${t.bi.map((z) => ZWECKE[z]).join(', ')}`));
      if (t.partner) zeilen.push(li(`${t.partner} Partner mit Zustimmung`));
    }
    if (t.status === 'tcloaded') zeilen.push(li('(gespeicherte Entscheidung von einem früheren Besuch)'));
    $('tcfListe').replaceChildren(...zeilen);
  }

  $('ereignisse').replaceChildren(...(s?.ereignisse || []).map((e) => li(`${((e.t - s.start) / 1000).toFixed(1)} s – ${e.text}`)));

  const { protokoll = {} } = await chrome.storage.local.get('protokoll');
  const liste = (protokoll[seite] || []).slice(0, 5);
  $('protokoll').replaceChildren(
    ...(liste.length ? liste.map((e) => li(`${zeit(e.t)}: ${STATUS[e.status]?.[0] || e.status} (${e.cmp})${e.tcf ? ` – ${e.tcf}` : ''}`)) : [li('–')]),
  );
}

$('seite').textContent = seite || 'keine Webseite';
$('version').textContent = `Version ${chrome.runtime.getManifest().version}`;

$('aktiv').addEventListener('change', async (e) => {
  const p = await laden();
  p.aktiv = e.target.checked;
  await speichern(p);
  chrome.tabs.reload(tab.id);
});
$('seiteAn').addEventListener('change', async (e) => {
  const p = await laden();
  if (e.target.checked) delete p.ausnahmen[seite];
  else p.ausnahmen[seite] = 'aus';
  await speichern(p);
  chrome.tabs.reload(tab.id);
});
$('vorgaben').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

await zeigen();
chrome.storage.onChanged.addListener(zeigen);
