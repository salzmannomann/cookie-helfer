import { laden, speichern, seitenName } from './lib/prefs.js';
import { STATUS, zeit } from './texte.js';
import { abweichungen, ZWECKE } from './lib/tcf.js';

const $ = (id) => document.getElementById(id);
const li = (text) => Object.assign(document.createElement('li'), { textContent: text });

// Tab-ID kann für Tests per ?tab= übergeben werden
const param = new URLSearchParams(location.search).get('tab');
const tab = param ? await chrome.tabs.get(Number(param)) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
const seite = seitenName(tab?.url || '');

async function zeigen() {
  const key = `tab:${tab.id}`;
  const s = (await chrome.storage.session.get(key))[key];
  const st = s?.status === 'suche' && Date.now() - s.start > 10000 ? 'nichts' : s?.status;
  const [titel, klasse] = STATUS[st] || ['Keine Angaben für diese Seite', ''];
  const box = $('status');
  box.className = `status ${klasse}`;
  box.replaceChildren(Object.assign(document.createElement('b'), { textContent: titel }));
  if (s?.cmp) box.append(Object.assign(document.createElement('span'), { className: 'leise', textContent: `Anbieter: ${s.cmp}` }));
  if (s?.selbsttest === false) box.append(li('Kontrolle: Ablehnung nicht bestätigt'));

  // TCF: was die Seite laut eigener Schnittstelle tatsächlich erlaubt hat
  const t = s?.tcf;
  $('tcf').hidden = !t;
  if (t) {
    const zeilen = [];
    if (!t.gdpr) zeilen.push('DSGVO gilt laut Seite nicht');
    else if (['abgelehnt', 'ausgeblendet', 'abweichung'].includes(s.status)) {
      const abw = abweichungen(t);
      zeilen.push(...(abw.length ? abw.map((a) => `⚠ ${a}`) : ['✓ nur Notwendiges erlaubt']));
    } else {
      zeilen.push(t.zwecke.length ? `Zustimmung: ${t.zwecke.length === 11 ? 'alle Zwecke' : t.zwecke.map((z) => ZWECKE[z]).join(', ')}` : 'keine Zustimmung');
      if (t.bi.length) zeilen.push(`berechtigtes Interesse: ${t.bi.map((z) => ZWECKE[z]).join(', ')}`);
      if (t.partner) zeilen.push(`${t.partner} Partner mit Zustimmung`);
    }
    if (t.status === 'tcloaded') zeilen.push('(gespeicherte Entscheidung von einem früheren Besuch)');
    $('tcfListe').replaceChildren(...zeilen.map(li));
  }

  $('ereignisse').replaceChildren(...(s?.ereignisse || []).map((e) => li(`${((e.t - s.start) / 1000).toFixed(1)} s – ${e.text}`)));

  const { protokoll = {} } = await chrome.storage.local.get('protokoll');
  const liste = (protokoll[seite] || []).slice(0, 5);
  $('protokoll').replaceChildren(...(liste.length ? liste.map((e) => li(`${zeit(e.t)}: ${STATUS[e.status]?.[0] || e.status} (${e.cmp})${e.tcf ? ` – ${e.tcf}` : ''}`)) : [li('–')]));
}

if (seite) {
  $('seite').textContent = seite;
  const prefs = await laden();
  $('seiteAus').checked = prefs.ausnahmen[seite] === 'aus';
  $('seiteAus').addEventListener('change', async (e) => {
    const p = await laden();
    if (e.target.checked) p.ausnahmen[seite] = 'aus';
    else delete p.ausnahmen[seite];
    await speichern(p);
    chrome.tabs.reload(tab.id);
  });
} else {
  $('seiteAus').disabled = true;
}

await zeigen();
chrome.storage.onChanged.addListener(zeigen);
