# Cookie-Helfer

Chrome-Erweiterung, die Cookie-Banner automatisch nach eigenen Vorgaben beantwortet: wo möglich ablehnen,
nur das Nötigste erlauben. Alles läuft lokal, nichts wird an einen Server geschickt.
Projektbeschreibung: [docs/projektbeschreibung.md](docs/projektbeschreibung.md) · Vorgaben: [docs/vorgaben.md](docs/vorgaben.md)

## Stand

**Schritt 1 – Messung vorab.** Es gibt noch keine Erweiterung, nur das Messskript.
Ergebnis: [messung/ergebnisse/bericht.md](messung/ergebnisse/bericht.md)

## Messung selbst ausführen (empfohlen: am eigenen Rechner in Österreich)

```
npm install
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run messung
```

- `npm run messung -- orf spiegel` misst nur Seiten, deren URL eines der Wörter enthält.
- Seitenliste: `messung/seiten.json`; Screenshots vorher/nachher landen in `messung/ergebnisse/bilder/` (nicht im Repo).
- Das Skript klickt nur über die festen Regeln von autoconsent auf „Ablehnen“/„Auswahl speichern“ – nie auf Abo-, Kauf- oder Login-Knöpfe.

## Fremdcode

- [`@duckduckgo/autoconsent`](https://github.com/duckduckgo/autoconsent) (MPL-2.0) – derzeit nur als Entwicklungsabhängigkeit für die Messung.
  Beim Einbau in die Erweiterung kommt es mit LICENSE-Datei nach `extension/vendor/autoconsent/`.

## Grenzen der ersten Messung (11.10.2026)

- Gemessen aus einem Rechenzentrum in den **USA**, nicht aus Österreich. Seiten, die Banner nur in der EU zeigen
  (amazon, ebay, google, youtube, booking, reddit …), erscheinen deshalb als „kein Banner“. Die DSGVO-Banner der
  meisten AT/DE-Medien kamen trotzdem.
- Zwei Läufe weichen bei einzelnen Seiten voneinander ab (chefkoch, gutefrage, golem): Banner kommen verzögert oder
  in Varianten. Für belastbare Zahlen: am eigenen Rechner wiederholen (siehe oben).
