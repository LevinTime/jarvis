# Jarvis

Persönlicher Assistent. Levin schreibt, was ansteht, zum Beispiel
„morgen kommen meine Eltern zurück, heute noch Whirlpool sauber machen, abends Hühner füttern“.
Jarvis macht daraus Aufgaben, merkt sich offene Gespräche und erinnert daran.

## Funktionen

- Aufgaben anlegen, auflisten, abhaken. Status: `offen` → `in Arbeit` → `erledigt` oder `fehlgeschlagen`. Hängende `in Arbeit` lassen sich zurücksetzen.
- Optionales `faelligAm`. Wiederholung `taeglich` oder `woechentlich`: nach „erledigt“ liegt die nächste Instanz bereit, zum Beispiel „jeden Abend Hühner füttern“.
- Notizen zu Personen und losen Plänen (`person`, `text`, `erstelltAm`, `offen`, optionales `erinnernAm`). Beispiel: „Hab mit Tim gequatscht, wollte ihm wegen Samstag noch antworten.“
- Gesprächsprotokolle aus `transcripts/` lesen.
- Telegram-Bot und Web-Chat nutzen dasselbe Modul `src/assistant.ts`: Nachricht rein, Werkzeuge ausführen, Antwort raus.
- Erinnerungen: fällige Aufgaben und Notizen einmal, dazu um 8:00 Europe/Berlin eine Tagesübersicht mit offenen Aufgaben und offenen Punkten.
- JSON-Dateien (`tasks.json`, `notes.json`, `reminder-state.json`) werden atomar geschrieben. Fehlen Keys in `.env`, kommt eine klare Meldung statt eines Absturzes. Logs haben einen Zeitstempel.

## Geplant

- Wetter für Issum
- Lokal mit Ollama statt der Cloud-API

`OLLAMA_URL` und `WEATHER_LOCATION` stehen schon in der Vorlage, der Code nutzt sie noch nicht.

## Struktur

- `src/cli.ts`           CLI
- `src/assistant.ts`     gemeinsamer Chat für Bot und Web
- `src/bot/`             Telegram-Bot, Werkzeuge, Erinnerungen
- `src/web/`             lokale Chat-Seite und Aufgabenliste
- `src/llm.ts`           Grok/xAI-Client
- `src/tasks/`           Aufgaben, Status, Wiederholung
- `src/notes/`           Notizen zu Personen und offenen Punkten
- `src/transcripts/`     Protokolle lesen
- `src/load-env.ts`      `.env` und fehlende Keys
- `src/log.ts`           Logs mit Zeitstempel
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

### Web

```powershell
npm run web
```

Dann im Browser `http://127.0.0.1:3000` öffnen. Chat, Aufgaben abhaken oder zurücksetzen, offene Punkte schließen. Nur dieser Rechner erreicht die Seite.

### Tests

```powershell
npm test
npm run typecheck
```
