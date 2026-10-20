# Redesign-Inventar (vor dem UI-Umbau)

Stand: 2026-10-20, Branch `main`, Commit `d6ea3d8`.
Nur Bestand. Keine Funktion ist hier schon geändert.

## Tests

- `npm test`: **116** bestanden, 0 fehlgeschlagen (Dauer etwa 3,5 s).
- Lint-Skript: keines im Repo (`package.json` hat kein `lint`). Prüfung ist `npm run typecheck` (`tsc` für Server und `web/`).
- E2E: `npm run test:e2e` (Playwright, vier Handybreiten, Overflow). Vorher-Bilder dieses Auftrags liegen getrennt in `docs/screenshots/vorher/`.

## Seiten

Fünf Wisch-Seiten in `web/src/App.tsx`, Start ist **Heute** (Index 1). Navigation unten, `aria-label` „Seiten“.

| Seite | Datei | Was sie kann |
|---|---|---|
| Kalender | `web/src/pages/Calendar.tsx` | Monat und Woche, Tages-Stundenraster 07–22, Termin anlegen, ändern, löschen, Wiederholung. Wischen nur am Bildschirmrand. Lazy geladen. |
| Heute | `web/src/pages/Dashboard.tsx` + `web/src/widgets/Board.tsx` | Begrüßung, Live-Status, Widget-Raster, Notizen-Sheet, Einstieg in Einstellungen und Gedächtnis. |
| Aufgaben | `web/src/pages/Todos.tsx` | Gruppen überfällig / heute / demnächst / ohne Datum / erledigt. Anlegen mit Datum und Wiederholung. Wischen rechts erledigt, links löschen, Toast Rückgängig. |
| Chat | `web/src/pages/Chat.tsx` | Verlauf, ältere Nachrichten, Senden, Tipp-Hinweis, Fehler erneut senden, langer Druck merkt eine falsche Antwort. |
| T3 | `web/src/pages/T3.tsx` | Erreichbarkeit von `JARVIS_T3_URL` bzw. der Adresse aus den Einstellungen. Link öffnet T3 im neuen Tab. Kein Einbetten. |

Darüber, keine eigenen Wisch-Seiten:

- **Einstellungen** (`Settings.tsx`): Vollbild-Dialog.
- **Gedächtnis** (`Memory.tsx`): Fakten suchen, filtern, anlegen, ändern, löschen.
- **Kosten** (`Usage.tsx`): Sheet über dem Dashboard. Heute, 7 Tage, Monat, 30 Tage, Balken, Quelle, Zweck. Schätzung, nicht die xAI-Rechnung.
- **Notizen**: Sheet auf Heute, offene Notizen schließen.
- **Offline**: eigene Ansicht, wenn der erste Status-Call scheitert.
- **Update**: Banner, wenn der Service Worker eine neue Version hat.

## Widgets auf Heute

Quelle: `DEFAULT_WIDGETS` in `src/settings/model.ts`. Größe `s` | `m` | `l`. Raster fest 4 Spalten (`web/src/styles.css`, keine Media Query).

| Widget | Inhalt |
|---|---|
| Uhr (`clock`) | Begrüßung, Uhrzeit, Hinweis „nach unten für die Kosten“. |
| Status | Punkte Bot, Modell, Spiegel. |
| Aufgaben | „n heute“, „n offen“, „n überfällig“. Eine große Kachel, keine Liste. |
| Termine | Bis zu drei kommende Aufgaben mit Uhrzeit. Kein Tagesband. |
| Neu | Schnell eine Aufgabe anlegen. |
| Notizen | Anzahl und die erste offene Notiz. |
| Kosten | Heute- und Monatsbetrag, Budget-Balken. Öffnet das Kosten-Sheet. |
| Chat | Letzte Nachricht, gekürzt, springt zum Chat. |
| T3 | Erreichbar oder nicht. |
| Gedächtnis | Öffnet die Gedächtnis-Ansicht. |

Anordnen heute: langer Druck (480 ms) startet den Bearbeitungsmodus. `@dnd-kit` sortiert. Größe im Kreis s → m → l. Widgets ausblenden und aus einer Liste wieder einblenden. Layout liegt in den Einstellungen (`widgets`), nicht in `localStorage`. Am PC bleibt dasselbe 4-Spalten-Raster, nur breiter.

## Einstellungen

Gespeichert lokal (`jarvis-settings`) und per `PUT /api/settings`.

- Sprache der Oberfläche: Deutsch / Englisch. Wörterbücher `web/src/i18n/de.json` und `en.json` müssen dieselben Schlüssel haben.
- Antwortsprache von Jarvis: Deutsch oder Englisch (ein Satz im Prompt, keine Extra-Übersetzung).
- Thema: Midnight, Ocean, Aurora, Graphit, Hell. Akzentfarbe optional.
- Textgröße 85–130 % (`--text-scale` auf `html`). Dichte kompakt / normal / luftig ändert `--pad`, `--gap`, `--row` nur wenig (74 / 88 / 104 px Zeilenhöhe).
- Rundung, Animationen reduzieren, Haptik.
- Kosten-Check: an / aus / nur bei Käufen. Selbst-Check an/aus.
- T3-Adresse, ohne Zugangsdaten.
- Layout zurücksetzen: Widgets auf `DEFAULT_WIDGETS`.
- Gedächtnis öffnen.

## Zustände

- Verbindung: `offline` | `connecting` | `connected` (Punkt und Text live / verbinde / offline).
- Laden: Skelett, solange kein Status da ist.
- Fehlerbanner mit „Nochmal“ auf Heute, Aufgaben und Chat.
- Budget-Banner auf Heute bei 80 % und über 100 % (`JARVIS_MONTHLY_BUDGET_USD`, Standard 15). Blockiert den Chat nicht.
- Chat: leer, ausstehend, Fehler, „Jarvis tippt…“, Sprung zu neuen Nachrichten.
- Aufgaben: leer, Toast nach Löschen, Status offen / in Arbeit / fehlgeschlagen / erledigt.
- Kalender: leer, Lade- und Speicherfehler, Drawer neu oder ändern.
- T3: lädt, erreichbar, nicht erreichbar.
- Kosten: noch keine Einträge, oder Beträge. Lokal fehlt `data/usage.json` (Datei ist nicht da). Die Kachel zeigt deshalb 0 bzw. „noch keine Zahlen“.
- PWA: „Update verfügbar“ / „Neu laden“.

## Swipe-Navigation

Logik in `src/web-logic/gesture.ts`, Karussell Embla.

- Horizontal, klar und mindestens 48 px, wechselt die Seite. Senkrecht scrollt.
- Kein Seitenwechsel auf `input`, `textarea`, `select` und `[data-no-swipe]`.
- Kalender (`data-gesture=calendar`) nur, wenn der Finger in den äußeren 28 px startet.
- Aufgabenzeile: ab 88 px nach rechts erledigt, nach links löschen.
- Auf der Begrüßung öffnet Ziehen nach unten das Kosten-Sheet. Das ist kein Seitenwechsel.
- Die Leiste unten ist die sichere Navigation und folgt der Wisch-Position.

## Telegram-Sync

- `npm start` (`src/main.ts`) fährt Bot und Web in **einem** Prozess mit gemeinsamer Historie (`data/messages.json`) und Event-Bus.
- Web-Nachrichten gehen als `🖥 Web:` an Telegram. Echos dieser Zeilen gelten nicht als neue Nutzernachricht.
- Telegram-Nachrichten und Aufgaben-/Notizänderungen kommen in der App über SSE an.
- `npm run bot` und `npm run web` einzeln teilen nur die JSON-Dateien, nicht den Bus. Beide gleichzeitig würden Erinnerungen doppelt schicken.
- Erinnerungen: fällige Aufgabe oder Notiz einmal, plus um 8:00 Europe/Berlin die Tagesübersicht.

## SSE

- `GET /api/events`, Kopf `Last-Event-ID`.
- Ereignisse: `message:new`, `message:updated`, `task:changed`, `note:changed`, `usage:new`, `status:changed`.
- Zu alte ID: ein `resync`, die App lädt neu.
- Heartbeat, Abbruch räumt den Listener auf. Client: `web/src/feed.ts`, Backoff über `src/web-logic/live.ts`.

## PWA

- `vite-plugin-pwa`, `display: standalone`, Hochformat, `theme_color` `#07070f`.
- Icons 192, 512, maskable, Apple Touch.
- Service Worker mit Rückfall auf `index.html`, `/api` ausgenommen. Update per Rückfrage, nicht still.
- `index.html` hat schon `viewport-fit=cover`. Die App nutzt `env(safe-area-inset-*)` und `100dvh` über `--vvh`.
- Eingaben erben `1rem`. Die Root-Schrift kann über den Text-Regler unter 16 px fallen.
- Kein `maximum-scale`, kein `user-scalable=no`.

## API, die die Oberfläche braucht

`GET /api/status`, Tasks (`GET` `POST` `PATCH` `DELETE`, dazu complete/reset), Notes, Calendar, Settings, T3, Memory, Corrections, Usage, Messages, `POST /api/chat` (Feld `text` → 202, Antwort später per SSE), `GET /api/events`.

Server bindet nur an `127.0.0.1`. Kein Tailscale Funnel im Code.

## Was dieser Umbau nicht anfasst

Bot, `prompts/system.md`, Aufgaben-Logik, Wiederholung, Gedächtnis-Speicher, Telegram-Versand. Kosten-Datei nur prüfen. `data/` und `.env` bleiben lokal.

## Ist-Probleme (sichtbar)

- Heute stapelt große, fast leere Karten. Verschieben geht nur nach langem Druck.
- Keine eigene Desktop-Ansicht: unter 1920 px gilt dasselbe 4-Spalten-Raster wie auf dem Handy.
- Kosten-Kachel und der Hinweis „nach unten für die Kosten“ bleiben auf dem Dashboard, der Betrag ist 0, solange `data/usage.json` fehlt.
- Die Aufgaben-Kachel ist zwei Rasterzeilen hoch (Zeile 88 px), nur für zwei Textzeilen.
- Dichte und Textgröße ändern die leeren Flächen kaum.

Vorher-Bilder in `docs/screenshots/vorher/`, je 1920×1080 und 428×926: Heute, Kalender, Aufgaben, Chat, T3. Konsole dabei ohne Fehler. Heute zeigt die gestreckten, fast leeren Karten und die Kosten-Zeile.

## Abgleich nach dem Umbau

Stand nach den UI-Commits auf `main`. `npm test`: **125** bestanden, 0 fehlgeschlagen. `npm run typecheck` grün. Lint-Skript gibt es weiter nicht.

Nachher-Bilder in `docs/screenshots/nachher/`: 1920×1080 und 428×926, jeweils Heute, Anordnen, Orb (idle, listening, thinking, speaking), Kalender, Aufgaben, Chat, T3. Playwright-Konsole ohne Fehler.

### Erhalten

- Seiten Kalender, Heute, Aufgaben, Chat, T3. Wischen über Embla, Leiste „Seiten“ mit denselben fünf Zielen.
- Telegram in beide Richtungen, SSE, PWA, Gedächtnis, Notizen, Kosten-Check, Selbst-Check, Sprache, Thema, Akzent, Rundung, Animationen, Haptik.
- Aufgaben anlegen, erledigen, löschen. Kalender mit Monat, Woche und dem großen Stundenraster.
- Widget-Arten `clock` und `cost` bleiben gültig, damit alte Einstellungen nicht brechen.

### Entfernt (nur die Dashboard-Anzeige)

- Kosten-Kachel und der Hinweis „nach unten für die Kosten“ auf Heute. Die Zahlen liegen unter Einstellungen, „Verbrauch ansehen“.
- Langer Druck zum Anordnen. Stattdessen der Schalter „Anordnen“.
- Der Textgrößen-Regler wirkt nicht mehr. Der Wert `textScale` bleibt im Modell, damit die API unverändert bleibt.

### Neu

- Kopfzeile „Guten Tag, Levin“ mit Datum, ohne eigene Box. Orb in der Mitte, Zustände idle, listening, thinking, speaking.
- Kompakte Status-Chips und die Zeile „n heute · n offen · n Termine“. Darunter bis zu drei Aufgaben, der Rest als „+N“.
- Tagesleiste 07–22 nur auf Heute. Der große Kalender bleibt auf der Seite Kalender.
- Raster mit react-grid-layout 2.2.2. Größen S, M, L. Ziehen nur am Griff, nur im Anordnen-Modus. Layout je Breakpoint in `localStorage`, Version 1, Fallback auf das Standardraster.
- Eigene Spalten: unter 640 px vier, ab 640 acht, ab 1024 zwölf. Inhalt ab 1024 px zentriert, höchstens etwa 1280 px.
- Dichte Kompakt / Normal / Groß (intern weiter `airy`). Ändert Schrift, Abstand und Kachelhöhe. „Dashboard-Layout zurücksetzen“ in den Einstellungen.
- Zurück und Aktualisieren in der App. iPhone: `viewport-fit=cover`, `100dvh` im Standalone, Eingaben mindestens 16 px, `overscroll-behavior`, Touch-Ziele 44 px.

### Kosten-Check

`data/usage.json` fehlt lokal. Deshalb zeigt die Oberfläche 0. Web (`npm run web` und `npm start`) und Telegram nutzen dasselbe `createRuntime`: ein Grok-Client, `onUsage` hängt an `data/usage.json`. Es gibt keinen zweiten Zähler. Fehlgeschlagene Aufrufe und unbekannte Modelle zählen absichtlich 0. Kein kleiner Bug, deshalb kein Fix.
