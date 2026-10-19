# Jarvis

Persönlicher Assistent. Levin schreibt, was ansteht, zum Beispiel
„morgen kommen meine Eltern zurück, heute noch Whirlpool sauber machen, abends Hühner füttern“.
Jarvis macht daraus Aufgaben, merkt sich offene Gespräche und erinnert daran.

## Funktionen

- Aufgaben anlegen, auflisten, abhaken. Status: `offen` → `in Arbeit` → `erledigt` oder `fehlgeschlagen`. Hängende `in Arbeit` lassen sich zurücksetzen.
- Optionales `faelligAm`. Wiederholung `taeglich` oder `woechentlich`: nach „erledigt“ liegt die nächste Instanz bereit, zum Beispiel „jeden Abend Hühner füttern“.
- Notizen zu Personen und losen Plänen (`person`, `text`, `erstelltAm`, `offen`, optionales `erinnernAm`). Beispiel: „Hab mit Tim gequatscht, wollte ihm wegen Samstag noch antworten.“
- Gesprächsprotokolle aus `transcripts/` lesen.
- Telegram-Bot und Web-Chat nutzen dasselbe Modul `src/assistant.ts`: Nachricht rein, Werkzeuge ausführen, Antwort raus. `npm start` teilt sich dafür eine Nachrichten-Historie und einen Live-Bus.
- Erinnerungen: fällige Aufgaben und Notizen einmal, dazu um 8:00 Europe/Berlin eine Tagesübersicht mit offenen Aufgaben und offenen Punkten.
- JSON-Dateien (`tasks.json`, `notes.json`, `reminder-state.json`) werden atomar geschrieben. Fehlen Keys in `.env`, kommt eine klare Meldung statt eines Absturzes. Logs haben einen Zeitstempel.

## Geplant

- Wetter für Issum
- Lokal mit Ollama statt der Cloud-API

`OLLAMA_URL` und `WEATHER_LOCATION` stehen schon in der Vorlage, der Code nutzt sie noch nicht.

## Struktur

- `src/cli.ts`           CLI
- `src/main.ts`          Bot und Web in einem Prozess (`npm start`)
- `src/assistant.ts`     gemeinsamer Chat für Bot und Web
- `src/bot/`             Telegram-Bot, Werkzeuge, Erinnerungen
- `src/web/`             HTTP-Server, API, alte Chat-Seite für die Tests
- `web/`                 Handy-App (React, Vite). Der Build liegt in `web/dist` und wird nicht committed
- `src/llm.ts`           Grok/xAI-Client
- `src/messages/`        gemeinsame Nachrichten-Historie
- `src/usage/`           Token und geschätzte Kosten
- `src/tasks/`           Aufgaben, Status, Wiederholung, Kalender
- `src/notes/`           Notizen zu Personen und offenen Punkten
- `src/transcripts/`     Protokolle lesen
- `src/load-env.ts`      `.env` und fehlende Keys
- `src/log.ts`           Logs mit Zeitstempel, ohne Tokens
- `src/atomic-file.ts`   atomares Speichern
- `transcripts/`         Markdown-Protokolle
- `prompts/system.md`    System-Prompt
- `skills/`              vorgesehene Fähigkeiten (Wetter, Kalender)
- `config/.env.example`  Vorlage für `.env`
- `data/`                lokale Daten, gitignored
- `tests/`               Tests ohne echte API-Calls

## Starten

Voraussetzung: Node.js 22+.

```powershell
git clone https://github.com/LevinTime/jarvis
cd jarvis
npm install
copy config\.env.example .env
```

`.env` bleibt lokal und wird nicht committed.

### .env

| Variable | Wofür |
|---|---|
| `GROK_API_KEY` | Chat über Grok. Ohne Key startet das Web trotzdem, der Chat sagt Bescheid. Der Bot startet nicht. |
| `GROK_MODEL` | Modell, Standard `grok-4` |
| `TELEGRAM_BOT_TOKEN` | Bot-Token von BotFather. Pflicht für `npm run bot`. |
| `ALLOWED_CHAT_ID` | Nur dieser Chat darf den Bot nutzen. Pflicht für `npm run bot`. |
| `TZ` | Zeitzone, Standard `Europe/Berlin` |
| `JARVIS_DATA_DIR` | Optional, Standard `data/` |
| `JARVIS_TRANSCRIPTS_DIR` | Optional, Standard `transcripts/` |
| `JARVIS_WEB_PORT` oder `PORT` | Web-Port, Standard `3000`. Der Server bindet nur an `127.0.0.1`. |
| `JARVIS_MONTHLY_BUDGET_USD` | Optional. Monatsbudget in US-Dollar. Ab 80 Prozent und ab 100 Prozent warnt die App. |
| `JARVIS_ALLOWED_TS_USER` | Optional. Tailscale-Login. Siehe unten. |
| `OLLAMA_URL` | Reserviert, noch ungenutzt |
| `WEATHER_LOCATION` | Reserviert, noch ungenutzt |

Fehlen `GROK_API_KEY`, `TELEGRAM_BOT_TOKEN` oder `ALLOWED_CHAT_ID`, beendet sich der Bot mit einer Zeile und Exit-Code 1.

### CLI

```powershell
npm run jarvis -- add --titel "Hühner füttern" --aufgabe "jeden Abend Hühner füttern" --faelligAm 2026-10-17T18:00:00+02:00 --wiederholung taeglich
npm run jarvis -- add --id pool --titel Whirlpool --aufgabe putzen
npm run jarvis -- list
npm run jarvis -- get pool
npm run jarvis -- run pool
npm run jarvis -- reset pool
npm run jarvis -- log
npm run jarvis -- transcripts
npm run jarvis -- transcript 2026-10-16
```

`reset` setzt nur eine hängende Aufgabe in `in Arbeit` wieder auf `offen`.

### Telegram-Bot

1. Werte in `.env` eintragen.
2. `npm run bot`
3. Dem Bot `/start` schreiben, die angezeigte Chat-ID als `ALLOWED_CHAT_ID` setzen, Bot neu starten.

```powershell
npm run bot
```

Befehle: `/start`, `/aufgaben`, `/erledigt <id>`.
Freitext geht an Grok. Fällige Aufgaben und Notizen werden einmal erinnert. Um 8:00 Europe/Berlin kommt die Tagesübersicht.

### Web allein

```powershell
npm run web
```

Dann im Browser `http://127.0.0.1:3000` öffnen. Die Handy-App ist da, sobald `web/dist` gebaut ist (`npm run web:build`). Telegram ist in diesem Modus nicht verbunden. Für App und Bot zusammen: `npm start`.

### Handy-App über Tailscale

`npm start` baut das Frontend, wenn `web/dist` fehlt oder älter als der Quelltext ist, und startet Bot und Web in einem Prozess. Nur so kommen Telegram und die App live beim selben Verlauf an. `npm run bot` und `npm start` nicht gleichzeitig laufen lassen, sonst gehen die Erinnerungen doppelt raus.

```powershell
npm install
npm start
```

Der Server hört nur auf `127.0.0.1`, Port `3000` (oder `JARVIS_WEB_PORT`). Von außen kommt man ausschließlich über Tailscale Serve ran. Funnel nicht einschalten. Funnel würde die Seite ins öffentliche Internet legen.

```powershell
tailscale serve --bg 3000
tailscale serve status
```

Im Tailscale-Admin die HTTPS-Zertifikate für diesen Rechner aktivieren. Auf dem Handy die angezeigte Adresse öffnen, zum Beispiel `https://<rechner>.<tailnet>.ts.net`. Im Browser „Zum Home-Bildschirm“ beziehungsweise „Zum Startbildschirm hinzufügen“. Die App liegt dann als eigene Kachel im Hochformat.

Optional `JARVIS_ALLOWED_TS_USER` in `.env` auf den eigenen Tailscale-Login setzen (der Name aus `tailscale status`). Requests mit einem anderen Header `Tailscale-User-Login` bekommen 403. Requests vom eigenen PC ohne diesen Header bleiben erlaubt. Der Schutz trägt nur, weil der Prozess an `127.0.0.1` gebunden ist und Tailscale den Header setzt.

Entwicklung mit Vite auf `127.0.0.1:5173`, Proxy auf die API: `npm run dev`.

### Wenn etwas hakt

- Der PC ist aus oder Tailscale hat keine Verbindung: die App zeigt „Jarvis ist gerade nicht da“, statt einer kaputten Seite.
- Zertifikatsfehler: HTTPS-Zertifikate im Tailscale-Admin aktivieren und die Seite neu laden. Funnel bleibt aus.
- „Telegram nicht verbunden“: `TELEGRAM_BOT_TOKEN` und `ALLOWED_CHAT_ID` eintragen und `npm start` benutzen. `npm run web` allein startet den Bot nicht.
- xAI antwortet mit 403 und ohne Guthaben: die Nachricht bleibt als Fehler stehen, der Prozess läuft weiter. Guthaben bei xAI prüfen, danach in der App „Erneut senden“.
- Der Port ist belegt: den anderen Prozess beenden oder `JARVIS_WEB_PORT` setzen und `tailscale serve` auf denselben Port zeigen lassen.

### Tests

```powershell
npm test
npm run typecheck
```
