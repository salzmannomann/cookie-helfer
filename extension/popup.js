import { laden, speichern, seitenName, istAus } from './lib/prefs.js';
import { STATUS, zeit } from './texte.js';
import { abweichungen, ZWECKE } from './lib/tcf.js';

const ZWECK_NAMEN = { funktional: 'Funktion', statistik: 'Statistik', werbung: 'Werbung', personalisierung: 'Personalisierung', partner: 'Partner', social_media: 'Soziale Medien' };
const ART_NAMEN = {
  ablehnen: 'Ablehnen', nur_notwendige: 'Nur Notwendige', einstellungen: 'Einstellungen', auswahl_speichern: 'Auswahl speichern',
  alle_akzeptieren: 'Zustimmen', schliessen: 'Schließen', abo_oder_kauf: 'Abo/Kauf', anmelden: 'Anmelden', sonstiges: 'sonstiges',
};

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

  // Unbekanntes Banner: Einordnung und Vorschlag
  const ki = s?.ki;
  const zeigeKi = !!ki && s.status === 'unbekannt';
  $('ki').hidden = !zeigeKi;
  if (zeigeKi) {
    const teile = [];
    if (ki.zusammenfassung) teile.push(ki.zusammenfassung);
    if (ki.zwecke?.length) teile.push(`Zwecke: ${ki.zwecke.map((z) => ZWECK_NAMEN[z] || z).join(', ')}`);
    if (ki.partner) teile.push(`${ki.partner} Partner`);
    if (ki.pur) teile.push('Zustimmen oder bezahlen');
    $('kiText').textContent = teile.join(' · ');
    $('kiText').hidden = !teile.length;
    const frage = !!ki.vorschlag && !ki.verworfen;
    $('kiFrage').hidden = !frage;
    $('kiKein').hidden = frage || ki.verworfen;
    if (frage) $('kiKnopf').textContent = ki.vorschlag.text;
    $('kiHinweis').hidden = !(frage && ki.vorschlag.hinweis);
    $('kiListe').replaceChildren(...ki.knoepfe.map((k) => li(`${k.text} → ${ART_NAMEN[k.art] || k.art}`)));
    $('kiQuelle').textContent = ki.quelle === 'ki' ? 'Eingeordnet von der lokalen KI (Gemini Nano).' : `Eingeordnet mit festen Regeln${ki.grund ? ` (${ki.grund})` : ''}.`;
  }

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
$('kiJa').addEventListener('click', async () => {
  $('kiJa').disabled = true;
  await chrome.runtime.sendMessage({ type: 'ch:kiKlick', tabId: tab.id, merken: $('kiMerken').checked });
  $('kiJa').disabled = false;
});
$('kiNein').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'ch:kiNein', tabId: tab.id }));
$('vorgaben').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

await zeigen();
chrome.storage.onChanged.addListener(zeigen);
