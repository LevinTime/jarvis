# Jarvis

Mein persönlicher KI-Assistent, inspiriert von Jarvis aus Iron Man.
Ich schreibe ihm einfach, was ansteht, z. B. "morgen kommen meine Eltern zurück,
heute noch Whirlpool sauber machen, abends Hühner füttern", und Jarvis
macht daraus Aufgaben, Termine und Erinnerungen.

## Funktionen (geplant)
- Chat über Telegram und eine Web-Oberfläche
- Aufgaben, Termine und Erinnerungen verwalten
- Wetter und Erinnerungen für Issum
- Lokal mit Ollama oder über eine Cloud-API (Grok/xAI)

## Struktur
- src/          Code (Bot, Web-UI, Logik)
- src/tasks/    Task-Modul (anlegen, Status, Log, CLI)
- prompts/      System-Prompts
- skills/       Fähigkeiten (Wetter, Kalender, ...)
- config/       Konfiguration, .env.example

## Starten
1. Repo klonen: `git clone https://github.com/LevinTime/jarvis`
2. `config/.env.example` nach `.env` kopieren und Keys eintragen
3. `npm install`

### Tasks (CLI)

Daten liegen in `data/` (gitignored). Optional: `JARVIS_DATA_DIR`.

```powershell
npm run jarvis -- add --titel "Hühner füttern" --aufgabe "abends Hühner füttern"
npm run jarvis -- add --json "{\"id\":\"pool\",\"titel\":\"Whirlpool\",\"aufgabe\":\"putzen\"}"
npm run jarvis -- list
npm run jarvis -- get <id>
npm run jarvis -- run <id>
npm run jarvis -- log [id]
```

```powershell
npm test
npm run typecheck
```
