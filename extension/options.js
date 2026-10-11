import { laden, speichern } from './lib/prefs.js';

const $ = (id) => document.getElementById(id);

async function zeigen() {
  const p = await laden();
  $('aktiv').checked = p.aktiv;
  $('pur').value = p.pur;
  const seiten = Object.keys(p.ausnahmen).sort();
  $('ausnahmen').replaceChildren(
    ...(seiten.length
      ? seiten.map((s) => {
          const li = document.createElement('li');
          const knopf = Object.assign(document.createElement('button'), { textContent: 'wieder einschalten' });
          knopf.addEventListener('click', async () => {
            const q = await laden();
            delete q.ausnahmen[s];
            await speichern(q);
            zeigen();
          });
          li.append(`${s} `, knopf);
          return li;
        })
      : [Object.assign(document.createElement('li'), { textContent: 'keine', className: 'leise' })]),
  );
}

async function aendern(fn) {
  const p = await laden();
  fn(p);
  await speichern(p);
  $('gespeichert').textContent = 'Gespeichert.';
}

$('aktiv').addEventListener('change', (e) => aendern((p) => (p.aktiv = e.target.checked)));
$('pur').addEventListener('change', (e) => aendern((p) => (p.pur = e.target.value)));
zeigen();
