# Jarvis

Mein persönlicher KI-Assistent, inspiriert von Jarvis aus Iron Man.
Ich schreibe ihm einfach, was ansteht, z. B. "morgen kommen meine Eltern zurück,
heute noch Whirlpool sauber machen, abends Hühner füttern", und Jarvis
macht daraus Aufgaben, Termine und Erinnerungen.

## Vorhanden
- Task-Modul: anlegen, abfragen, abarbeiten, optionales `faelligAm`
- Status: `offen` → `in Arbeit` → `erledigt` (oder `fehlgeschlagen`)
- Transkript-Zugriff: Markdown-Protokolle aus `transcripts/`
- CLI unter `src/cli.ts`
- Telegram-Bot: Grok mit Function-Calling, Erinnerungen

## Geplant
- Web-Oberfläche
- Wetter für Issum
- Lokal mit Ollama als Alternative zur Cloud-API

## Struktur
- `src/cli.ts`          CLI (Tasks + Transkripte)
- `src/bot/`            Telegram-Bot, Tools, Erinnerungen
- `src/llm.ts`          Grok/xAI-Client
- `src/tasks/`          Task-Logik (Store, Status, Log)
- `src/transcripts/`    Gesprächsprotokolle lesen und parsen
- `transcripts/`        Markdown-Protokolle
- `prompts/`            System-Prompts
- `skills/`             Fähigkeiten (Wetter, Kalender, …)
- `config/`             `.env.example`
- `data/`               lokale Tasks und Logs (gitignored)

## Starten

Voraussetzung: Node.js 22+

```powershell
git clone https://github.com/LevinTime/jarvis
cd jarvis
npm install
```

`.env` liegt im Projektordner (gitignored). Vorlage: `config/.env.example`.

### Telegram-Bot starten

1. `config/.env.example` nach `.env` im Projektordner kopieren.
2. `GROK_API_KEY`, `TELEGRAM_BOT_TOKEN` und `ALLOWED_CHAT_ID` eintragen.
3. Chat-ID holen: Bot `/start` schreiben, die angezeigte ID in `.env` setzen, Bot neu starten.

```powershell
npm run bot
```

Befehle: `/start` (Chat-ID), `/aufgaben`, `/erledigt <id>`.
Freitext geht an Grok und wird zu Aufgaben, z. B. „heute noch Whirlpool sauber machen, abends Hühner füttern“.
Fällige offene Tasks werden einmal erinnert. Um 8:00 Europe/Berlin kommt eine Tagesübersicht.

### Tasks (CLI)

Daten liegen in `data/` (gitignored). Optional: `JARVIS_DATA_DIR`.

```powershell
npm run jarvis -- add --titel "Hühner füttern" --aufgabe "abends Hühner füttern"
npm run jarvis -- add --id pool --titel Whirlpool --aufgabe putzen
npm run jarvis -- list
npm run jarvis -- get pool
npm run jarvis -- run pool
npm run jarvis -- reset pool
npm run jarvis -- log
npm run jarvis -- transcripts
npm run jarvis -- transcript 2026-10-16
```

```powershell
npm test
npm run typecheck
```
