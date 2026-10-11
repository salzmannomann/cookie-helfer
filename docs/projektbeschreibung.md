# Projekt „Cookie-Helfer“: Chrome-Erweiterung, die Cookie-Banner nach eigenen Vorgaben erledigt

Stand: 11. Oktober 2026. Entstanden aus der Arbeit an Ruhepol (Repo `salzmannomann/ruhepol`).

---

## 1. Ziel

Cookie-Banner sollen automatisch so beantwortet werden, wie ich es vorgebe, ohne dass ich klicken muss.
Wo möglich, wird abgelehnt bzw. nur das Nötigste erlaubt. Eine lokale KI hilft bei unbekannten Bannern
und fasst zusammen, was eine Seite eigentlich will. Alles läuft lokal auf dem Rechner, nichts wird an einen
Server geschickt.

## 2. Meine Vorgaben (zu Projektbeginn festlegen, Vorschlag in Klammern)

| Frage | Vorschlag |
|---|---|
| Unbedingt notwendige Cookies | immer erlaubt (lässt sich nicht abwählen) |
| Funktionale / Präferenz-Cookies (Sprache, Region) | erlaubt |
| Statistik / Reichweitenmessung | **nein** |
| Personalisierte Werbung, Profilbildung, Partner | **nein** |
| „Berechtigtes Interesse“-Schalter | **alle ausschalten** |
| „Zustimmen oder bezahlen“ (Pur-Abo, z. B. derStandard, Spiegel, Zeit, heise) | **zustimmen, nie bezahlen** – oder: nichts tun, mich entscheiden lassen |
| Unbekanntes Banner, KI ist sich nicht sicher | **nichts klicken**, nur Hinweis im Popup |
| Ausnahmen je Seite | im Popup einstellbar, wird gemerkt |

## 3. Ist das möglich? Ja – so:

1. **Feste Regeln für bekannte Banner-Anbieter (der Großteil).**
   Fast alle Banner stammen von wenigen Anbietern (Consent-Management-Plattformen, „CMP“): OneTrust,
   Usercentrics, Didomi, Cookiebot, Sourcepoint, consentmanager, Quantcast, TrustArc, Borlabs u. a.
   Für sie gibt es erprobte Klick-Regeln.
   → Grundlage: die quelloffene Bibliothek **autoconsent** von DuckDuckGo
   (`@duckduckgo/autoconsent`, Lizenz MPL-2.0; steckt im DuckDuckGo-Browser und in Ghostery).
   Sie kennt einige hundert Banner-Typen und kann „ablehnen“ (opt-out) zuverlässig ausführen.
   Lizenz beim Einbau prüfen und im Repo vermerken (wie bei Ruhepol unter `vendor/` mit LICENSE-Datei).

2. **Europäischer Standard TCF („IAB Transparency & Consent Framework“).**
   Viele Banner bieten die Schnittstelle `__tcfapi` an. Darüber lässt sich **nach** dem Klick auslesen,
   welche Zwecke tatsächlich erlaubt wurden → Kontrolle, ob die Vorgaben wirklich umgesetzt sind.
   (Läuft im Seitenkontext, also als Skript mit `"world": "MAIN"` – wie `shadow-hook.js` bei Ruhepol.)

3. **Lokale KI nur für den Rest: Chromes eingebautes Modell (Gemini Nano, Prompt API `LanguageModel`).**
   - Liest Bannertext und Knöpfe und ordnet zu: „Ablehnen“, „Einstellungen“, „Nur notwendige“,
     „Auswahl speichern“, Schalter je Zweck.
   - Fasst zusammen, was enthalten ist (z. B. „Statistik, personalisierte Werbung, 214 Partner“).
   - Erkennt „Zustimmen oder bezahlen“.
   - Antwort als festes JSON-Schema (wie `lib/nano.js` bei Ruhepol), damit nichts Freies passiert.
   - Nano ist nicht auf jedem Rechner verfügbar → ohne Nano laufen nur die festen Regeln.

## 4. Bekannte Schwierigkeiten und wie damit umgehen

| Problem | Umgang |
|---|---|
| Irreführende Knöpfe („Weiter“ = alles akzeptieren) | KI klickt anfangs **nie selbst**, nur Vorschlag; später nur bei sehr klaren Fällen (gemessen) |
| „Zustimmen oder bezahlen“ | nach meiner Vorgabe; **nie** etwas kaufen, nie Abo-Knöpfe |
| Banner in Iframes / Shadow DOM | Content Script in allen Frames (`all_frames`), Shadow DOM wie bei Ruhepol |
| Seite lädt nach dem Klick nicht richtig | Popup-Schalter „auf dieser Seite aus“, Klick-Protokoll je Seite |
| Banner kommt bei jedem Besuch wieder | Ergebnis je Seite merken; prüfen, ob die Seite die Entscheidung speichert |
| Nach dem Klick doch zugestimmt? | Kontrolle über TCF bzw. Banner-Cookies; bei Widerspruch Hinweis |

**Harte Regeln (nie):** nichts kaufen, kein Abo, kein Login, keine Formulare mit Daten, keine Knöpfe
außerhalb des Banners, nichts an Server senden.

## 5. Warum eine eigene Erweiterung und nicht in Ruhepol

- anderer Zweck (Datenschutz statt Schutz vor belastenden Inhalten), getrennte Einstellungen
- getrennt abschaltbar, wenn eine Seite nach einem Klick hakt
- klarere Berechtigungen, unabhängige Updates; Ruhepol ist schon groß (Sprachmodell, OCR)
- Wiederverwendbar aus Ruhepol: Nano-Anbindung (`lib/nano.js`, Offscreen Document),
  Shadow-DOM-Behandlung (`shadow-hook.js`), Testaufbau (Playwright, lokale Testseiten), ZIP-Update-Ablauf

## 6. Aufbau (Vorschlag)

```
extension/
  manifest.json          MV3; content_scripts (all_frames, document_start), eines davon world MAIN für __tcfapi
  background.js          Service Worker: Vorgaben, Protokoll je Seite, Nano-Aufrufe über Offscreen Document
  content.js             Banner finden, autoconsent ausführen, sonst Bannertext an die KI geben
  tcf-probe.js           (MAIN world) liest __tcfapi getTCData aus, meldet erlaubte Zwecke zurück
  offscreen.html/js      Gemini Nano (LanguageModel), festes Antwortschema
  lib/prefs.js           Vorgaben + Bereinigung (wie lib/settings.js bei Ruhepol)
  lib/nano.js            Prompt + JSON-Schema für „Knöpfe zuordnen / Zwecke zusammenfassen“
  popup.html/js          Status der aktuellen Seite: was wurde gewählt, was ist enthalten, Ausnahme setzen
  options.html/js        Vorgaben (Tabelle aus Abschnitt 2)
  vendor/autoconsent/    Bibliothek + Regeln + LICENSE
test/
  site/                  nachgebaute Banner (OneTrust-, Usercentrics-, Didomi-, TCF-, „Pur-Abo“-Varianten, unbekanntes Banner)
  e2e.mjs                Playwright: Banner wird nach Vorgabe beantwortet, TCF-Kontrolle stimmt, nie „Abo“ geklickt
README.md                Bedienung, Messungen, Grenzen (Deutsch)
```

## 7. Vorgehen in Schritten (jeweils erst messen, nur Besseres einbauen)

1. **Messung vorab:** ca. 50 Seiten, die ich nutze (orf, derStandard, krone, kurier, heute, spiegel, zeit,
   willhaben, geizhals, amazon, Behörden, Banken …). Für jede: welcher Banner-Anbieter, erledigt autoconsent
   ihn, ist es „Zustimmen oder bezahlen“, was steht nach dem Klick in TCF.
   → Ergebnis: wie viel bleibt für die KI übrig.
2. **Version 0.1:** nur feste Regeln (autoconsent) + meine Vorgaben + Popup mit Protokoll.
3. **Version 0.2:** TCF-Kontrolle nach dem Klick; Hinweis, wenn etwas nicht stimmt.
4. **Version 0.3:** KI für unbekannte Banner, zuerst nur **Vorschlag** im Popup („Ablehnen klicken?“).
5. **Version 0.4:** KI klickt selbst – nur wenn die Messung zeigt, dass sie bei eindeutigen Bannern nie
   „alles akzeptieren“ trifft.
6. Laufend: Fehlfälle per Screenshot / Konsolen-Zeile melden, Regel ergänzen, Testfall dazu.

## 8. Arbeitsweise (wie bei Ruhepol)

- Kommunikation und Oberfläche auf Deutsch
- alles lokal, keine Server, keine Telemetrie
- nur einbauen, was gemessen besser ist; Messungen im README dokumentieren
- jede Änderung mit Test; `npm test` muss grün sein
- Versionsnummer in `manifest.json` und `package.json` hochzählen
- Auslieferung als ZIP + Terminal-Befehl zum Aktualisieren, z. B.:
  ```
  f=$(ls -t ~/Downloads/cookie-helfer-*.zip | head -1) && rm -rf /tmp/ch && unzip -q "$f" -d /tmp/ch && rsync -a /tmp/ch/cookie-helfer/ ~/Documents/Chrome/cookie-helfer/ && echo "Aktualisiert mit $f"
  ```
  danach in chrome://extensions bei der Erweiterung auf ↻ klicken
- Entwicklung auf einem Branch, Pull Request nach main erst auf Zuruf

## 9. Vor dem Start erledigen

1. Auf GitHub ein neues, leeres Repository anlegen, z. B. `salzmannomann/cookie-helfer`.
2. Eine neue Claude-Code-Sitzung mit **nur diesem Repository** starten (dann steht in der Kopfzeile nicht mehr
   „ketoplaner, schlagwortfilter …“).
3. Die Vorgaben in Abschnitt 2 entscheiden (oder die Vorschläge übernehmen).
4. Diese Datei in die erste Nachricht kopieren oder ins Repo legen, dazu den Startauftrag unten.

## 10. Startauftrag für die neue Sitzung (zum Kopieren)

> Wir bauen die Chrome-Erweiterung „Cookie-Helfer“ nach der beigefügten Projektbeschreibung.
> Meine Vorgaben: [Tabelle aus Abschnitt 2 übernehmen oder anpassen].
> Beginne mit Schritt 1 (Messung auf ca. 50 Seiten): Prüfe für jede Seite den Banner-Anbieter, ob
> autoconsent ihn nach meinen Vorgaben erledigt, ob es „Zustimmen oder bezahlen“ ist und was danach in TCF
> steht. Zeig mir das Ergebnis, bevor du etwas baust. Arbeite wie bei Ruhepol: Deutsch, alles lokal,
> nur Gemessenes einbauen, Tests, ZIP mit Terminal-Befehl.
