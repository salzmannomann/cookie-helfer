# Cookie-Helfer

Chrome-Erweiterung, die Cookie-Banner automatisch nach eigenen Vorgaben beantwortet: wo möglich ablehnen,
nur das Nötigste erlauben. Alles läuft lokal, nichts wird an einen Server geschickt.
Projektbeschreibung: [docs/projektbeschreibung.md](docs/projektbeschreibung.md) · Vorgaben: [docs/vorgaben.md](docs/vorgaben.md)

## Stand: Version 0.2

- **Feste Regeln** (autoconsent von DuckDuckGo, 886 Banner-Typen): Banner werden abgelehnt.
- **„Zustimmen oder bezahlen“** (Pur-Abo, contentpass): nach Vorgabe *zustimmen* – oder in den Vorgaben auf
  *nichts tun* umstellen. Erkannt werden Sourcepoint (derStandard, Spiegel, heute, FAZ, Welt, Bild, heise, golem …),
  consentmanager (chefkoch, vienna.at) und contentpass (wetter.com). Geklickt wird nur der vom Anbieter
  gekennzeichnete Zustimmen-Knopf, und nur wenn sein Text nach Zustimmen klingt und nichts von Abo/Bezahlen enthält.
- **Eigene Regeln** (`extension/regeln/eigene.json`) für Anbieter, die autoconsent nicht kennt: Piwik PRO.
- **TCF-Kontrolle** (neu in 0.2): Nach dem Ablehnen liest `tcf-probe.js` über `__tcfapi` aus, was die Seite
  tatsächlich gespeichert hat. Ist mehr erlaubt als das Notwendige (z. B. „berechtigtes Interesse“ oder Partner),
  zeigt das Popup „Abgelehnt – aber nicht alles“ mit den Zwecken (Symbol „!“ orange). Gemessen: sn.at, tt.com und
  willhaben lassen nach „Alle ablehnen“ das berechtigte Interesse für 6 Zwecke an.
- **Unbekannte Banner**: nichts klicken, Hinweis im Popup (Symbol „?“).
- **Popup**: Status der Seite, Ablauf, frühere Besuche, Schalter „auf dieser Seite ausschalten“.
- Symbol am Erweiterungsknopf: ✓ abgelehnt · Z zugestimmt (Zustimmen oder bezahlen) · € offen (deine Entscheidung) · ! rot nicht erledigt · ! orange abgelehnt, aber laut TCF nicht alles · ? unbekanntes Banner.

Noch nicht: berechtigtes Interesse selbst ausschalten (nach Messung), lokale KI für unbekannte Banner (0.3).

## Installation (einmalig)

1. ZIP herunterladen, dann im Terminal:
   ```
   mkdir -p ~/Documents/Chrome && f=$(ls -t ~/Downloads/cookie-helfer-*.zip | head -1) && rm -rf /tmp/ch && unzip -q "$f" -d /tmp/ch && rsync -a --delete /tmp/ch/cookie-helfer/ ~/Documents/Chrome/cookie-helfer/ && echo "Installiert aus $f"
   ```
2. In Chrome `chrome://extensions` öffnen, rechts oben **Entwicklermodus** einschalten,
   **Entpackte Erweiterung laden** → Ordner `Dokumente/Chrome/cookie-helfer` wählen.

## Aktualisieren

```
f=$(ls -t ~/Downloads/cookie-helfer-*.zip | head -1) && rm -rf /tmp/ch && unzip -q "$f" -d /tmp/ch && rsync -a --delete /tmp/ch/cookie-helfer/ ~/Documents/Chrome/cookie-helfer/ && echo "Aktualisiert mit $f"
```
danach in `chrome://extensions` bei Cookie-Helfer auf ↻ klicken.

## Entwicklung

| Befehl | Zweck |
|---|---|
| `npm test` | Vorgaben-Tests + Ende-zu-Ende-Test mit nachgebauten Bannern (`test/site/`) |
| `npm run echt -- orf spiegel` | Erweiterung auf echten Seiten ausprobieren (braucht Internet) |
| `npm run zip` | `dist/cookie-helfer-<version>.zip` bauen |
| `npm run vendor` | autoconsent nach einem Update nach `extension/vendor/` kopieren |
| `npm run icons` | Symbole neu erzeugen |

## Messung (Schritt 1) selbst ausführen

```
npm install
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run messung
```

- `npm run messung -- orf spiegel` misst nur Seiten, deren URL eines der Wörter enthält.
- Seitenliste: `messung/seiten.json`; Screenshots vorher/nachher landen in `messung/ergebnisse/bilder/` (nicht im Repo).
- Das Skript klickt nur über die festen Regeln von autoconsent auf „Ablehnen“/„Auswahl speichern“ – nie auf Abo-, Kauf- oder Login-Knöpfe.

## Fremdcode

- [`@duckduckgo/autoconsent`](https://github.com/duckduckgo/autoconsent) 16.50.0, Mozilla Public License 2.0 –
  unverändert in `extension/vendor/autoconsent/` (mit LICENSE).

## Messungen

| Datum | Standort | Bericht |
|---|---|---|
| 11.10.2026 | Bad Schallerbach, AT (eigener Mac) | [bericht.md](messung/ergebnisse/bericht.md) – maßgeblich |
| 11.10.2026 | Rechenzentrum USA | [bericht-us.md](messung/ergebnisse/bericht-us.md) – Banner, die nur in der EU erscheinen, fehlen |

Die Messung aus Österreich stimmt bei 52 von 60 Seiten mit der US-Messung überein; die Unterschiede sind
EU-only-Banner (amazon, google, youtube, booking, reddit, ichkoche, oe24, gutefrage).
