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

## Messungen

| Datum | Standort | Bericht |
|---|---|---|
| 11.10.2026 | Bad Schallerbach, AT (eigener Mac) | [bericht.md](messung/ergebnisse/bericht.md) – maßgeblich |
| 11.10.2026 | Rechenzentrum USA | [bericht-us.md](messung/ergebnisse/bericht-us.md) – Banner, die nur in der EU erscheinen, fehlen |

Die Messung aus Österreich stimmt bei 52 von 60 Seiten mit der US-Messung überein; die Unterschiede sind
EU-only-Banner (amazon, google, youtube, booking, reddit, ichkoche, oe24, gutefrage).
