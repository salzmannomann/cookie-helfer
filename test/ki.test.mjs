import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textSicher, regelEinordnung, vorschlag, bereinigen } from '../extension/lib/ki.js';

test('sichere Ablehnen-Texte (aus der Messung)', () => {
  for (const t of ['Ablehnen', 'Alle ablehnen', 'REFUSE ALL', 'Nur Notwendige', 'Nur essentielle Cookies akzeptieren', 'Nicht technische Cookies ablehnen', 'Nur notwendige Cookies erlauben'])
    assert.equal(textSicher(t), true, t);
});

test('nie vorgeschlagen: Zustimmen, Abo, Unklares', () => {
  for (const t of ['Alle akzeptieren', 'Alle Cookies akzeptieren', 'Ich bin einverstanden', 'OK', 'Weiter', 'Einstellungen', 'Pur-Abo abschließen', 'Werbefrei für 3,99€ / Monat', 'Anmelden', 'Alle notwendigen und Marketing akzeptieren', ''])
    assert.equal(textSicher(t), false, t);
});

const banner = (knoepfe, text = 'Wir verwenden Cookies und ähnliche Technologien.') => ({
  text,
  knoepfe: knoepfe.map((t, i) => ({ nr: i + 1, text: t })),
});

test('Vorschlag nach Regeln (ohne Modell): ÖBB, Bank Austria, Sozialversicherung', () => {
  let b = banner(['Alle Cookies akzeptieren', 'Meine Cookie-Auswahl', 'Nicht technische Cookies ablehnen']);
  assert.deepEqual(vorschlag(regelEinordnung(b), b), { nr: 3, text: 'Nicht technische Cookies ablehnen' });
  b = banner(['ACCEPT ALL', 'REFUSE ALL', 'Cookie Settings']);
  assert.equal(vorschlag(regelEinordnung(b), b).text, 'REFUSE ALL');
  b = banner(['Alle Cookies akzeptieren', 'Nur essentielle Cookies akzeptieren']);
  assert.equal(vorschlag(regelEinordnung(b), b).text, 'Nur essentielle Cookies akzeptieren');
  b = banner(['Alle akzeptieren', 'Einstellungen']);
  assert.equal(vorschlag(regelEinordnung(b), b), null);
});

test('Modell sagt „ablehnen“, Text ist aber „Alle akzeptieren“ → kein Vorschlag', () => {
  const b = banner(['Alle akzeptieren', 'Einstellungen']);
  const e = bereinigen({ zusammenfassung: 'x', zwecke: [], partner: 0, zustimmenOderBezahlen: false, knoepfe: [{ nr: 1, art: 'ablehnen' }] }, b);
  assert.equal(vorschlag(e, b), null);
});

test('Zustimmen oder bezahlen → kein Vorschlag', () => {
  const b = banner(['Akzeptieren und weiter', 'Werbefrei für 3,99€ / Monat'], 'Mit Werbung weiterlesen oder werbefrei mit contentpass');
  assert.equal(vorschlag(regelEinordnung(b), b), null);
});

test('bereinigen verwirft Unbekanntes', () => {
  const b = banner(['Ablehnen']);
  const e = bereinigen({ zusammenfassung: 7, zwecke: ['werbung', 'hack'], partner: -3, knoepfe: [{ nr: 9, art: 'ablehnen' }, { nr: 1, art: 'kaputt' }] }, b);
  assert.deepEqual(e, { zusammenfassung: '7', zwecke: ['werbung'], partner: 0, zustimmenOderBezahlen: false, knoepfe: [] });
});

test('reiner Cookie-Hinweis (Kleine Zeitung): „Verstanden“ vorschlagen', () => {
  const b = banner(['Datenschutzinformation', 'Verstanden'], 'Cookie-Hinweis Diese Website verwendet ausschließlich technisch notwendige Cookies. Sie sind erforderlich, damit die Website sicher und ordnungsgemäß funktioniert. Weitere Informationen finden Sie in unserer Datenschutzinformation.');
  assert.deepEqual(vorschlag(regelEinordnung(b), b), { nr: 2, text: 'Verstanden', hinweis: true });
});

test('„Verstanden“ bei echter Einwilligung → kein Vorschlag', () => {
  const b = banner(['Verstanden'], 'Wir verwenden nur notwendige Cookies sowie Cookies für Statistik und Marketing unserer Partner.');
  assert.equal(vorschlag(regelEinordnung(b), b), null);
  const c = banner(['Einstellungen', 'Verstanden'], 'Diese Website verwendet ausschließlich technisch notwendige Cookies.');
  assert.equal(vorschlag(regelEinordnung(c), c), null, 'zwei Knöpfe mit Wirkung');
});

test('Messfälle (echte Banner): feste Regeln treffen jeden Fall, kein Fehlgriff', async () => {
  const fs = await import('node:fs');
  const faelle = JSON.parse(fs.readFileSync(new URL('../extension/ki-faelle.json', import.meta.url)));
  for (const f of faelle) {
    const v = vorschlag(regelEinordnung(f), f);
    assert.equal(v ? v.text : null, f.erwartet, f.seite);
  }
});

test('messen(): Regeln allein → alle Treffer; Modell, das „Alle akzeptieren“ für Ablehnen hält → abgefangen', async () => {
  const fs = await import('node:fs');
  const { messen } = await import('../extension/lib/ki.js');
  const faelle = JSON.parse(fs.readFileSync(new URL('../extension/ki-faelle.json', import.meta.url)));
  const r = await messen(faelle, async (b) => regelEinordnung(b));
  assert.equal(r.fehlgriffe, 0);
  assert.equal(r.treffer, faelle.length);
  // böswilliges Modell: jeder Knopf sei „ablehnen“
  const boese = await messen(faelle, async (b) => ({ ...regelEinordnung(b), knoepfe: b.knoepfe.map((k) => ({ nr: k.nr, art: 'ablehnen' })) }));
  assert.equal(boese.fehlgriffe, 0, 'Regeln verhindern Fehlgriffe');
  assert.ok(boese.modellirrtuemer > 20);
});

test('Info-Link „Notwendige Cookies“ ist kein Ablehnen', () => {
  assert.equal(textSicher('Notwendige Cookies'), false);
  assert.equal(textSicher('Nur technisch notwendige Cookies'), true);
  assert.equal(textSicher('Notwendige Cookies akzeptieren'), true);
});

test('Modell erkennt „Alle ablehnen“ nicht (wie Nano bei geizhals) → Regeln schlagen trotzdem vor; Modell sagt Pur → kein Vorschlag', () => {
  const b = banner(['Konfigurieren', 'Alle ablehnen', 'Akzeptieren']);
  const modell = bereinigen({ zusammenfassung: '', zwecke: [], partner: 0, zustimmenOderBezahlen: false, knoepfe: b.knoepfe.map((k) => ({ nr: k.nr, art: 'sonstiges' })) }, b);
  assert.equal(vorschlag(modell, b).text, 'Alle ablehnen');
  assert.equal(vorschlag({ ...modell, zustimmenOderBezahlen: true }, b), null);
});
