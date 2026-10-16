# Jarvis

Mein persönlicher KI-Assistent, inspiriert von Jarvis aus Iron Man.
Ich schreibe ihm einfach, was ansteht, z. B. "morgen kommen meine Eltern zurück,
heute noch Whirlpool sauber machen, abends Hühner füttern", und Jarvis
macht daraus Aufgaben, Termine und Erinnerungen.

## Vorhanden
- Task-Modul: anlegen, abfragen, abarbeiten
- Status: `offen` → `in Arbeit` → `erledigt` (oder `fehlgeschlagen`)
- CLI unter `src/cli.ts`

## Geplant
- Chat über Telegram und eine Web-Oberfläche
- Call-Transkripte im Chat-Kontext
- Wetter und Erinnerungen für Issum
- Lokal mit Ollama oder über eine Cloud-API (Grok/xAI)

## Struktur
- `src/cli.ts`       Task-CLI
- `src/tasks/`       Task-Logik (Store, Status, Log)
- `prompts/`         System-Prompts
- `skills/`          Fähigkeiten (Wetter, Kalender, …)
- `config/`          `.env.example` (Keys, noch nicht von der CLI gelesen)
- `data/`            lokale Tasks und Logs (gitignored)

## Starten

Voraussetzung: Node.js 22+

```powershell
git clone https://github.com/LevinTime/jarvis
cd jarvis
npm install
```

`.env` aus `config/.env.example` ist für spätere API/Bot-Anbindung. Die Task-CLI braucht das noch nicht.

### Tasks (CLI)

Daten liegen in `data/` (gitignored). Optional: `JARVIS_DATA_DIR`.

```powershell
npm run jarvis -- add --titel "Hühner füttern" --aufgabe "abends Hühner füttern"
npm run jarvis -- add --id pool --titel Whirlpool --aufgabe putzen
npm run jarvis -- list
npm run jarvis -- get pool
npm run jarvis -- run pool
npm run jarvis -- log
```

```powershell
npm test
npm run typecheck
```
