# Stoffplan

Eine lokale Zuschnittwerkstatt für einzelne, ungefaltete Stofflagen. Schnittteile maßhaltig zeichnen, Nahtzugaben ergänzen und eine passende Anordnung finden. Die Oberfläche ist deutsch; Maße können in **mm und inch** eingegeben werden.

## Online testen

**[Stoffplan im Browser öffnen](https://dominik-steinweg.github.io/stoffplan/)** – ohne Installation oder Anmeldung. Für die Bedienung einen Computer mit Maus und Tastatur sowie einen aktuellen Edge- oder Chrome-Browser verwenden.

Berechnungen und Projektspeicherung laufen im eigenen Browser. Projekte werden nicht auf GitHub hochgeladen und nicht zwischen Geräten geteilt. Die Online-Adresse hat eine eigene lokale Sicherung, getrennt vom Windows-Start unter `127.0.0.1`. Vorhandene Projekte über **Projektdatei speichern** exportieren und auf der Website wieder importieren. Projektdateien dienen auch als Sicherung, falls Browserdaten gelöscht werden.

## Veröffentlichung

Das öffentliche Repository ist [Dominik-Steinweg/stoffplan](https://github.com/Dominik-Steinweg/stoffplan). GitHub Pages verwendet **GitHub Actions** als Quelle. Jeder Push auf `main` oder ein manueller Start des Workflows **Publish Stoffplan** prüft die Anwendung mit Node.js 24, erstellt den Produktionsbuild und veröffentlicht ihn nach erfolgreichen Unit- und Browsertests. Ein fehlgeschlagener Build ersetzt die bisher veröffentlichte Version nicht.

Nur der Pages-Build verwendet `STOFFPLAN_BASE_PATH=/stoffplan/`; lokale Starts verwenden weiterhin `/`. Für eine lokale Prüfung des Pages-Builds in PowerShell:

```powershell
$env:STOFFPLAN_BASE_PATH='/stoffplan/'
npm run build
$env:STOFFPLAN_TEST_BUILD='1'
npm run test:e2e
Remove-Item Env:STOFFPLAN_BASE_PATH, Env:STOFFPLAN_TEST_BUILD
```

Die Browsertests können mit `STOFFPLAN_TEST_URL=https://dominik-steinweg.github.io/stoffplan/` auch die veröffentlichte Website prüfen; dabei wird kein lokaler Testdienst gestartet. In GitHub Actions wird Playwrights Chromium verwendet, lokal der installierte Microsoft Edge. Persönliche Projektdateien und die lokale Konzeptdatei gehören nicht zur Veröffentlichung.

## Starten unter Windows

Voraussetzung: **Node.js 24** und ein aktueller Edge- oder Chrome-Browser.

**`Start-Stoffplan.cmd` doppelklicken.** Das Skript installiert beim ersten Start die festgeschriebenen Abhängigkeiten, erstellt die Anwendung und öffnet den Browser. Bei den weiteren Starts ist keine Internetverbindung erforderlich. Das Fenster des lokalen Startdienstes bleibt während der Nutzung geöffnet.

Alternativ in PowerShell:

```powershell
npm ci
npm run build
npm start
```

Die feste Adresse ist **http://127.0.0.1:5173**. Ist der Port bereits belegt, den laufenden Stoffplan verwenden oder dessen Startdienst beenden. Die Adresse wird nicht automatisch geändert, weil die lokale Projektsicherung an den Browser-Ursprung gebunden ist.

Für die Entwicklung: `npm run dev`.

## Ein erster Zuschnitt

1. Stoffbreite und Planungsmodus einstellen. Bei vorhandenem Stoff zusätzlich die Länge angeben. Die Stoffbreite enthält die Randreserven links und rechts; die Länge hat keine Randreserve.
2. Nahtzugabe, Randreserve und Teileabstand unabhängig voneinander festlegen. Alle drei dürfen null sein.
3. Rechteck, Dreieck, Kreis oder Oval hinzufügen oder mit **Freie Form** Punkte auf der Zeichenfläche setzen und anschließend den Umriss schließen.
4. Namen, Stückzahl und Bezugslinie einstellen. **Straight-Grain** richtet die Bezugslinie längs der Bahn aus, **Cross-Grain** quer zur Bahn.
5. **Automatisch anordnen** starten. Die Suche zeigt ihren besten geprüften Vorschlag und läuft höchstens ungefähr 30 Sekunden. Ein einzelner Geometrieschritt kann die Zeitgrenze geringfügig überschreiten. **Suche stoppen** beendet den Worker sofort; der letzte Vorschlag bleibt verfügbar.
6. **Variante übernehmen** übernimmt die ausgewählte Anordnung als rückgängig machbaren Schritt. Die Vorschau verändert die gespeicherte Anordnung noch nicht.
7. Teile nach Bedarf verschieben oder um 180° drehen. Regelverletzungen werden direkt angezeigt. Fehlende Exemplare können rechts mit **+** manuell eingesetzt werden.
8. Über **Projektdatei speichern** eine portable Sicherung erstellen.

Unter **Projekte** gibt es zwei integrierte Beispiele. Die **Maßprobe** ergibt 620 mm Stoffbedarf. Genau 620 mm passen; 619 mm sind zu kurz. 650 mm sind ausreichend. Eine bereits angeordnete Maßprobe liegt auch unter `beispiele/Massprobe.stoffplan.json`.

## Maße und Bearbeitung

- Ohne Einheitenzusatz gilt die gewählte Anzeigeeinheit. Explizite Angaben wie `25 mm`, `1.5 inch`, `1,5 in` und `1 1/2 inch` dürfen gemischt werden. `1 inch = 25,4 mm`.
- Dezimalpunkt und Dezimalkomma werden unterstützt; Tausendertrennzeichen nicht. Inch werden dezimal angezeigt.
- Intern bleiben alle Maße in mm gespeichert. Ein Wechsel der Anzeigeeinheit verändert die Geometrie nicht. Eine unverändert verlassene Eingabe überschreibt den gespeicherten Wert nicht mit dem gerundeten Anzeigewert.
- Kreis und Oval bleiben parametrisch: Durchmesser beziehungsweise Breite/Höhe ändern die exakte Grundform. **In freie Form umwandeln** ermöglicht anschließend die Punktbearbeitung.
- Jedes Schnittteil besitzt eine frei wählbare Farbe, die für alle Exemplare gilt und beim Kopieren oder Spiegeln übernommen wird.
- Ein ausgewählter Punkt kann numerisch oder per Maus bearbeitet werden. Eine ausgehende Kante lässt sich zur Bézierkurve machen. Deren Kontrollpunkte erscheinen goldfarben; die Bezugslinie ist blau markiert.
- **Punkt einfügen** teilt eine Kurve ohne Änderung ihrer Form. Änderungen an Gesamtbreite oder Gesamthöhe skalieren die Grundform ausdrücklich.
- Der Nullpunkt **(0, 0)** ist im Formeditor auch ohne Raster sichtbar. **Zum Nullpunkt** zentriert ihn ohne Zoomänderung. Die Koordinatenanzeige zeigt den wirksamen Zeichenpunkt; bei aktiviertem Einrasten wird der Ursprung innerhalb von acht Bildschirmpixeln exakt gefangen.
- Die Bezugslinie hat Vorauswahlen **0° ↓**, **45° ↘** und **90° →**. Anfang und Länge bleiben erhalten. Endpunkte lassen sich danach per Maus oder Koordinaten überschreiben. Die Wahl Längs/Quer bestimmt weiterhin die Ausrichtung dieser Linie auf dem Stoff; es gibt kein zusätzliches 45°-Häkchen.
- Das Raster ist einblendbar und seine Schrittweite einstellbar. Einrasten wird separat aktiviert. Zoom verändert keine Maße.
- Mausrad: Zoom; Leertaste + Ziehen oder mittlere Maustaste: Ansicht verschieben.
- Strg+Z: Rückgängig; Strg+Umschalt+Z oder Strg+Y: Wiederholen; Strg+S: Projektdatei speichern. Eingabefelder behalten ihre normale Textbearbeitung.

## Anordnungsvarianten

Die Suche erzeugt kompakte Anordnungen, Reihen und nach Schnittteil gruppierte Reihen. Nach Suchende oder **Suche stoppen** sind bis zu zehn unterschiedliche, vollständige und geprüfte Varianten auswählbar. Jede zeigt eine Miniatur, Stofflänge und Mehrbedarf. Varianten mit mehr als 20 % zusätzlicher Länge gegenüber der kürzesten gefundenen gültigen Lösung werden entfernt; genau 20 % sind erlaubt. Eine mathematisch optimale Packung wird nicht garantiert.

Die Auswahl ist zunächst eine Vorschau. Erst **Variante übernehmen** ändert die Hauptanordnung. Die Variantensammlung wird schon nach Suchende oder Stopp automatisch mit dem Projekt gespeichert und bleibt nach Übernahme und Wiederöffnung verfügbar. Die Sammlung und die Übernahme sind getrennt rückgängig machbar. Änderungen an Formen, Bezugslinien, Stoffrichtung, Mengen, Teilebestand oder Stoffvorgaben verwerfen die bisherigen Varianten. Namen, Farben, Anzeigeeinheiten und manuelle Platzierungen erhalten sie.

## Speicherung

Abgeschlossene Änderungen werden automatisch in **IndexedDB** gesichert. Unter **Projekte** können lokale Projekte wieder geöffnet und neue Projekte angelegt werden. Beim Start wird das zuletzt bearbeitete Projekt wiederhergestellt. Die vorhandene Anordnung wird geprüft, ohne automatisch eine neue Suche zu starten.

JSON-Projektdateien in Version 2 enthalten Originalkonturen einschließlich parametrischer Rundungen, Farben, Kurvenkontrollpunkte, Bezugslinien, Stückzahlen, Einstellungen, Platzierungen und bis zu zehn Varianten. Version-1-Projekte werden automatisch migriert; Koordinaten bleiben erhalten, Reserven gelten danach nur seitlich. Gespeicherte Varianten werden beim Öffnen erneut geprüft; ungültige Alternativen werden mit Hinweis entfernt. Auch ungültige oder unvollständige Bearbeitungsstände sind speicherbar. Beschädigte Dateien und unbekannte Formatversionen werden abgewiesen, bevor sie das geöffnete Projekt ersetzen.

Die lokale Sicherung gilt für diesen Browser und diese Adresse. Das Löschen der Browserdaten entfernt sie; Projektdateien bleiben die übertragbare Sicherung. Undo/Redo ist auf die laufende Sitzung und die letzten 100 Schritte begrenzt.

## Geometrie und Grenzen

- Clipper2-WASM berechnet Konturversatz und Polygonoperationen. Die automatische Suche verwendet No-Fit-Polygone einschließlich Einbuchtungen und Einschließungsfällen. Jede vorgeschlagene Anordnung wird unabhängig vom Platzierungsverfahren geprüft.
- Die Kandidatensuche verwendet vereinfachte Konturen mit höchstens 64 Stützpunkten je Polygon und einem zusätzlichen Suchabstand. Der Teileabstand wird erst nach der Kombination zweier Konturen berücksichtigt. Das hält die Suche auch bei Kurven schnell; die gespeicherten Formen, Nahtzugaben und die genaue Abschlussprüfung bleiben davon unberührt.
- Nahtzugaben verwenden Miter-Ecken mit Faktor 2. Lange Spitzen werden begrenzt. Originalgeometrie und Zuschneidekontur sind getrennt; Teileabstand und Randreserve werden zusätzlich und unabhängig geprüft.
- Kurven werden adaptiv polygonisiert. Die reguläre Abweichung beträgt höchstens 0,002 mm vor dem Konturversatz; für die Prüfung wird eine konservative Fehlerhülle verwendet. Kritische Kontakte werden mit 0,00005 mm erneut berechnet. Verbleibende Unsicherheit wird als ungültig markiert; dann ein kleines Stück Abstand lassen. Gerade Formen dürfen bei Abstand null exakt aneinanderliegen.
- Zielgenauigkeit der Konturberechnung: 0,01 mm. Clipper rechnet auf einem Raster von 0,000001 mm. Der angezeigte Stoffbedarf wird aufgerundet, um ihn nicht kleiner auszuweisen.
- Die Optimierung ist heuristisch: „Kürzeste gefundene Stofflänge“ ist kein Beweis eines mathematischen Minimums. Ein Scheitern der Suche wird von einem sicher erkennbaren Breitenhindernis unterschieden.
- Ausgelegt auf ungefähr 50 Exemplare; technische Obergrenzen: 200 Teildefinitionen, 500 Exemplare, 256 Kontrollpunkte je Teil, 10 MB je Projektdatei und 1.000.000 mm für einzelne Maßwerte. Sehr komplexe Kurven werden mit einer Fehlermeldung abgewiesen.
- Ein Außenumriss je Schnittteil, keine inneren Ausschnitte. Durch Nahtzugaben geschlossene Innenbereiche werden als gefüllte Fläche behandelt.
- Nicht enthalten: Foto-/Schnittmusterimport, Stoffbruch, Musterausrichtung, Strichrichtung, mehrere Stoffbahnen, Fixieren von Teilen bei der Suche und maßstäblicher Druck.

## Entwicklung und Prüfungen

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Die Browserprüfungen verwenden den installierten **Microsoft Edge** über Playwright. Für einen anderen installierten Browser den `channel` in `playwright.config.ts` anpassen. Screenshots und Fehler-Traces werden unter `test-results` abgelegt.

Auch der Produktionsbuild kann geprüft werden: zuerst `npm run build`, danach in PowerShell `$env:STOFFPLAN_TEST_BUILD='1'; npm run test:e2e`. Dieser Testdienst verwendet ausschließlich für die Prüfung Port 5174. Der normale Start bleibt auf Port 5173.

Die Tests prüfen Einheiten und Dateiformat, Konturversatz, 620/619-mm-Abnahme, Berührung und Abstand, konkaves Ineinanderschieben, Kurven, Bezugslinien, Mengen, 50 Exemplare sowie den Browserablauf mit manueller Bearbeitung, Undo/Redo, Spiegelvorschau, Dateisicherung und Wiederaufnahme.

Module: `src/domain` für Daten und Maße, `src/geometry` für Konturen und Validierung, `src/optimization` für die Worker-Suche, `src/persistence` für Projektdateien/IndexedDB und `src/ui` für Editor und Bedienung.

Die ausgelieferte Anwendung lädt keine Schriftarten, Skripte oder Geometrie-Dateien von externen Diensten. Die Abhängigkeiten werden durch `package-lock.json` festgeschrieben. Bibliothekshinweise stehen in `THIRD_PARTY_NOTICES.md`.
