import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bereinigen, seitenName, istAus, STANDARD } from '../extension/lib/prefs.js';

test('Standardvorgaben: zustimmen bei Pur, eingeschaltet, keine Ausnahmen', () => {
  assert.deepEqual(bereinigen(undefined), { ...STANDARD, ausnahmen: {} });
  assert.equal(bereinigen({}).pur, 'zustimmen');
});

test('ungültige Werte werden verworfen', () => {
  const p = bereinigen({ aktiv: 'ja', pur: 'bezahlen', ausnahmen: { 'www.Spiegel.de': 'aus', 'x y': 'aus', 'orf.at': 'kaufen' } });
  assert.equal(p.aktiv, true);
  assert.equal(p.pur, 'zustimmen');
  assert.deepEqual(p.ausnahmen, { 'spiegel.de': 'aus' });
});

test('seitenName', () => {
  assert.equal(seitenName('https://www.derstandard.at/story/1'), 'derstandard.at');
  assert.equal(seitenName('www2.example.com'), 'example.com');
  assert.equal(seitenName('kein url /'), '');
});

test('Ausnahme gilt auch für Unterdomains, nicht für fremde Seiten', () => {
  const p = bereinigen({ ausnahmen: { 'derstandard.at': 'aus' } });
  assert.equal(istAus(p, 'https://apps.derstandard.at/x'), true);
  assert.equal(istAus(p, 'https://notderstandard.at/'), false);
  assert.equal(istAus(bereinigen({ aktiv: false }), 'https://orf.at/'), true);
});

test('gemerkte Knöpfe: nur gültige Seiten und Texte, höchstens 5 je Seite', async () => {
  const { gelerntBereinigen } = await import('../extension/lib/prefs.js');
  assert.deepEqual(gelerntBereinigen({ 'www.OEBB.at': ['a', 'b', 'c', 'd', 'e', 'f'], 'x y': ['a'], 'orf.at': 'kaputt', 'wien.gv.at': [7, 'Nur Notwendige'] }), {
    'oebb.at': ['b', 'c', 'd', 'e', 'f'],
    'wien.gv.at': ['Nur Notwendige'],
  });
});
