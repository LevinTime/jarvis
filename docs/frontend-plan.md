# Handy-App — Abgleich mit dem Bestand

Baseline vor den Änderungen (2026-10-19): `npm test` 58 grün, `npm run typecheck` grün.

## Was schon da ist und wiederverwendet wird

- Aufgaben in `src/tasks/`: Status `offen`, `in Arbeit`, `erledigt`, `fehlgeschlagen`. `faelligAm`, `wiederholung` (`taeglich` | `woechentlich`). `run` legt nach „erledigt“ die nächste Instanz an (`nextOccurrence`, Europe/Berlin, inklusive Zeitumstellung). `recoverStale` setzt hängende `in Arbeit` nach 30 Minuten auf `fehlgeschlagen`. `reset` nur aus `in Arbeit` zurück auf `offen`.
- Notizen in `src/notes/`: `add`, `listOpen`, `close`. Felder `person`, `text`, `erinnertAm` heißt im Code `erinnernAm`, `offen`.
- Werkzeuge in `src/bot/tools.ts`: `add_task`, `list_tasks`, `complete_task`, `add_note`, `list_open_notes`, `close_note`, `list_transcripts`, `get_transcript`. `chatWithTools` bleibt der Tool-Loop.
- `createAssistant().reply()` bleibt unverändert die schmale Funktion, die der bestehende Test aufruft.
- Atomare JSON-Dateien über `src/atomic-file.ts`.
- Web bindet schon nur an `127.0.0.1` (`WEB_HOST`). Bestehende Routen bleiben: `GET /api/tasks`, `POST /api/tasks/:id/complete`, `POST /api/tasks/:id/reset`, `GET /api/notes`, `POST /api/notes/:id/close`, `POST /api/chat` mit Feld `message` und Antwort `{ reply }` (HTTP 200).
- Telegram: nur `ALLOWED_CHAT_ID`, `/start` vor dem Filter, grammy, 4096-Zeichen-Grenze. Fehlende Bot-Keys: `src/bot/index.ts` beendet sich mit Exit 1. Der Test `the bot exits cleanly when .env keys are missing` bleibt so.
- Zeitzone Europe/Berlin, System-Prompt `prompts/system.md` unverändert.

## Kollisionen und wie sie gelöst werden

| Auftrag | Bestand | Lösung |
|---|---|---|
| `POST /api/chat` mit `{text}` liefert 202, Antwort per SSE | Test erwartet `{message}` → 200 `{reply}` | Beide Formen. `message` bleibt synchron. `text` + `clientId` ist der App-Pfad (202). |
| `/` ist die neue SPA | Test erwartet die alte HTML-Seite (`Chat`, `Aufgaben`, `id="message"`, abhaken, zurücksetzen) | `createWebApp()` ohne `frontend` liefert weiter die alte Seite. `npm run web` und `npm start` übergeben `web/dist`. Fehlt der Build, kommt die Hinweis-Seite. |
| Fehlende Keys: Prozess startet trotzdem | `npm run bot` muss ohne Keys mit Exit 1 enden | Nur `src/main.ts` (`npm start`) startet ohne Keys und meldet den fehlenden Teil. `npm run bot` bleibt streng. |
| Eine Nachrichten-Historie als Grok-Kontext | `assistant.ts` hat keine Historie. Jeder Aufruf ist nur System-Prompt plus die aktuelle Nachricht | Neue Historie in `data/messages.json`. Migration sucht `history.json` und `chat-history.json`, findet im Bestand nichts und verliert nichts. Kontext: letzte Nachrichten, Zeichenbudget. `reply()` für den alten Test bleibt ohne Historie. |
| Übersetzung Deutsch → Englisch → Deutsch beibehalten | Es gibt keine solche Pipeline, weder im Prompt noch im Code. Der Prompt sagt: Deutsch, kein Englisch | Nichts eingebaut. Prompt und Tool-Loop bleiben. |
| PATCH/DELETE für Tasks | Das Task-Modul kann das nicht (`create`, `get`, `list`, `run`, `reset`, `recoverStale`, `log`) | `update` und `remove` kommen dazu. Status `erledigt` läuft über `run()`, damit die Wiederholung greift. Speicher bleibt `tasks.json`. |
| Fehlerformat `{error:{code,message}}` | Alte Routen liefern `{error: "text"}`, die alte Seite liest den String | Neue Routen nutzen das Objekt. Alte Routen behalten den String. |
| Origin-Prüfung auf POST | Die Tests senden keinen Origin | Fehlender Origin bleibt erlaubt (curl, Tests, eigener PC). Ein fremder Origin wird 403. |
| `JARVIS_ALLOWED_TS_USER` | tailscale serve kommt auf dem Server als 127.0.0.1 an | Header `Tailscale-User-Login` muss passen, wenn er da ist. Localhost ohne diesen Header bleibt erlaubt. Steht so im Beispiel. |
| Telegram-Text über 4096 Zeichen | `telegramText` kürzt mit `...` | Versand teilt in Teile. `telegramText` bleibt exportiert. |
| Kalender-Bibliothek `@schedule-x/react` | — | Eigene Monats-/Wochenansicht. Schedule-X ist für den Desktop gebaut, zieht viel JS und passt schlecht zum Hochformat. Die eigene Ansicht nutzt dieselben Berlin-Regeln wie `nextOccurrence`. |
| Vitest | Ein Testlaufer (`node:test`) ist schon da | Gesten und Store sind reines TypeScript und laufen im bestehenden `npm test`. Kein zweiter Runner. |
| Live-Sync | Bot und Web sind zwei Prozesse | `npm start` fährt beide in einem Prozess mit gemeinsamem Bus. Einzeln bleiben sie lauffähig, teilen dann aber nur die JSON-Dateien, nicht den Speicher-Bus. |
| Preistabelle | xAI-Preise ändern sich | Tabelle in `src/usage/prices.ts`, Stand 19.10.2026. Cache-Tokens extra. Unbekanntes Modell: Kosten 0 und Warnung. |

## Design

Dunkles „Lampen“-Thema: warmes Bernstein auf Nacht-Tinte, Glasflächen, eine Schrift der System-UI. Light Mode über `prefers-color-scheme` und einen Schalter.

Vier Seiten in einem horizontalen Wisch: Kalender, Heute, Aufgaben, Chat. Die Leiste unten zeigt, wo man ist, und ist die sichere Navigation. Kosten sind keine fünfte Wisch-Seite, sondern eine Ebene über dem Dashboard (Karte antippen oder auf der Begrüßung nach unten ziehen). So kollidiert die Geste nicht mit dem Scrollen der Karten.

Wischen wechselt die Seite nur bei klarer Horizontalen, nicht in Eingabefeldern, nicht im Kalender und nicht auf einer Aufgabenzeile (die hat ihr eigenes Wischen: rechts erledigt, links löschen).

Kalender und Kosten werden erst geladen, wenn man sie öffnet.

## Stellen, die sich ändern, und Risiko für die 58 Tests

- `src/web/server.ts`: Streaming der Antwort (nötig für SSE), neue Routen, Sicherheitsheader. Die alten Pfade und Statuscodes bleiben. Risiko: mittel, deshalb die Web-Tests nach jedem Schritt.
- `src/bot/telegram.ts`: längere Antworten werden geteilt, Echo-Filter für `🖥 Web:`. Risiko: gering, kein Test importiert das Modul.
- `src/bot/index.ts`: nutzt `handleUserMessage`, `requireEnv` und Exit 1 bleiben die ersten Schritte. Risiko: der Robustheits-Test.
- `src/llm.ts`: Usage-Hook und Timeout, Rückgabe ansonsten gleich. Risiko: gering.
- `src/tasks/service.ts`: neue Methoden, alte unverändert. Risiko: gering.
- `src/tasks/schedule.ts`: zusätzliche Exporte, `nextOccurrence` unverändert. Risiko: die DST-Tests.
- `src/assistant.ts`: `createAssistant` bleibt. Neu daneben: `handleUserMessage`. Risiko: der Assistant-Test.
- `package.json`: neue Scripts, `jarvis`, `bot`, `web`, `test` bleiben. `typecheck` prüft danach auch `web/`.

## Nicht angefasst

CLI-Befehle, Transkripte, Reminder-Texte, System-Prompt, die fünf bestehenden JSON-Formate (`tasks.json`, `notes.json`, `reminder-state.json`, `task-log.jsonl`).

## Festgelegt beim Bau

- CSP: `style-src` ist `'self' 'unsafe-inline'`. Embla, Wisch-Zeilen, Tastaturhöhe, Balken und `--vvh` setzen Style-Attribute. `script-src` bleibt `'self'`, der Service Worker registriert sich aus einer Datei.
- Wochenansicht: Leiste mit den sieben Tagen ab Montag, darunter die Agenda des gewählten Tags. Ein Sieben-Spalten-Zeitgitter ist im Hochformat unlesbar.
- Überfällig heißt: der Berlin-Tageskey liegt vor heute. Eine Uhrzeit, die heute schon vorbei ist, bleibt „heute“.
- `in Arbeit` und `fehlgeschlagen` bleiben in ihrer Datumsgruppe und bekommen ein Badge. Abhaken geht über `PATCH` mit Status `erledigt`, damit `run()` die nächste Wiederholung anlegt.
- Kosten sind eine Ebene über „Heute“, keine fünfte Wisch-Seite. Die Zeile „nach unten für die Kosten“ öffnet sie. Die Begrüßung selbst bleibt horizontal wischbar.
- Aktualisieren ist ein Button auf dem Dashboard. Die App hat kein Pull-to-refresh.
- Live-Gleichstand von Telegram und App gibt es nur mit `npm start`. `npm run bot` und `npm run web` einzeln teilen nur die JSON-Dateien, nicht den Event-Bus. Beides gleichzeitig starten würde die Erinnerungen doppelt schicken.
- Die Preise in `src/usage/prices.ts` sind die veröffentlichte Liste vom 19.10.2026, nicht die Rechnung. Die App sagt das auf der Kosten-Seite.
