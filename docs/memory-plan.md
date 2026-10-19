# Gedächtnis, Kosten-Check, Selbst-Check

Stand: 19. Oktober 2026. Baseline davor: `npm test` 107 grün, `npm run typecheck` beide Projekte grün.

Der bestehende Code hat Vorrang. Dieser Plan hält fest, wo der Auftrag und der Code sich beißen und welche Lösung gilt.

## Was schon da ist

- Ein Chat-Einstieg: `handleUserMessage` in `src/assistant.ts`, dann `chatWithTools`.
- Der System-Prompt ist die erste Nachricht und wird mit `.trim()` geschickt. Die Uhrzeit steht als letzte User-Nachricht hinter der Frage, damit der Cache am Prompt-Anfang greift (`tests/tools.test.ts`).
- `systemPromptFor` lässt Deutsch bytegleich und hängt bei Englisch nur `Reply in English.` an.
- Werkzeug-Runden laufen über denselben Client. Usage-Zwecke sind `chat`, `tool`, `translate`, `summary`.
- `createGrokClient` setzt `reasoning_effort` und `max_tokens` fest pro Prozess (Standard none und 500).
- Termine sind Aufgaben. Eine fällige offene Aufgabe löst schon genau eine Telegram-Erinnerung aus, gemerkt in `data/reminder-state.json`.
- Einstellungen liegen in `data/settings.json` und im Browser. Neue Felder bekommen in `normalizeSettings` einen Default, alte Dateien bleiben gültig.
- Die Handy-App hat fünf Swipe-Seiten. Einstellungen und Kosten sind Overlays, keine sechste Seite.
- `data/` ist gitignored. Atomare Writes laufen über `writeTextAtomic`.

## Konflikte und Lösungen

1. **Fakten nicht in den System-Prompt schreiben.** Sonst ändert sich der Cache-Prefix bei jedem Fakt. Die Fakten und die Kosten-Check-Lage kommen als eigene User-Nachricht zwischen Verlauf und Frage. Die Uhrzeit bleibt das letzte Stück. Fehlt beides, bleibt die Nachrichtenliste wie im bestehenden Test.
2. **Kein zweites Gedächtnis neben den Notizen.** Notizen bleiben offene Gesprächspunkte mit Erinnerung. Dauerhafte Sätze liegen in `data/memory.json`.
3. **Kosten-Check ohne Extra-Call.** Die Regel steht in `prompts/system.md`. Die Schalter `an`, `aus` und `kaeufe` stehen nur im variablen Kontext, nicht im festen Prompt. Default ist `an`.
4. **Lebenslage nicht hart codieren.** Der Satz „Levin ist budgetbewusst und bezieht ALG I.“ wird einmal angelegt, wenn `memory.json` noch fehlt. Löscht Levin ihn, kommt er nicht zurück.
5. **Selbst-Check nur als ein kurzer Call.** Auslöser sind Zahlen, Preise, Wochentage/Daten oder ein großgeschriebenes Wort nach dem Satzanfang. `max_tokens` 150 und `reasoning_effort` none gelten nur für diesen Call, der normale Chat bleibt bei 500. Maximal eine Nachbesserung. Schlägt der Call fehl, bleibt die erste Antwort. Abstellbar über `selfCheck`. Der Handler prüft nur, wenn die Einstellungen gelesen werden. `npm start` liest sie, Standard ist an. Ohne diese Anbindung bleibt der alte Chat bei einem Call, damit bestehende Tests keine zweite Runde sehen.
6. **Usage.** Neue Zwecke `memory` und `selfcheck`. Werkzeug-Runden fürs Merken bleiben `tool`, weil sie im bestehenden Tool-Loop laufen. `selfcheck` ist der Prüf-Call. `memory` ist reserviert und wird geloggt, sobald ein Call diesen Zweck trägt. Es gibt keinen zusätzlichen Merk-Call.
7. **Ähnlichkeit ist Text, kein Embedding.** Gleicher normalisierter Satz bestätigt nur das Datum. Ein Widerspruch (gleicher Anfang, genug gemeinsame Wörter, oder der kürzere Satz steckt im längeren) ersetzt den Text. Der alte Satz landet in `verlauf`. Kein zweiter aktiver Eintrag.
8. **Secrets.** Vor dem Speichern fliegen Muster für xAI-Keys, `sk-`-Keys, Telegram-Tokens und IBANs raus. Formulierungen wie „passwort: …“ oder „Passwort ist …“ mit einer Ziffer im Wert ebenfalls. Ein normaler Satz ohne solches Muster bleibt. Der Fakt wird nicht angelegt.
9. **Korrekturen.** `data/corrections.json` plus ein Gedächtnis-Eintrag `kategorie: korrektur`, Wichtigkeit 3. In der App per langem Druck auf die Antwort. In Telegram per 👎 oder per Antwort `falsch: …`. Dieselbe Korrektur wird nicht doppelt gespeichert.
10. **Keine sechste Swipe-Seite.** Gedächtnis ist ein Overlay, erreichbar über Einstellungen und ein Widget. Der Overflow-Test öffnet diese Ansicht.
11. **API.** `GET/POST/PATCH/DELETE /api/memory`. Korrekturen aus der App: `POST /api/corrections`, weil die Nutzlast Frage, falsche Antwort und Korrektur ist und nicht ein Fakt. `GET /api/memory` liefert zusätzlich die Korrekturen und die Zahl für den laufenden Berlin-Monat.

## Kosten pro Anfrage

- Merken, Ändern, Vergessen, Suche: kein LLM-Call.
- Kontext: höchstens etwa 800 Tokens extra, und nur passende Sätze plus Wichtigkeit 3. Der feste Prompt bleibt cachebar.
- Selbst-Check: nur bei Triggern, ein Call, höchstens 150 Antwort-Tokens, reasoning none. Ausgeschaltet: null.
- Kosten-Check: null zusätzliche Calls.

## Stand nach der Umsetzung

`npm test` 116 grün, `npm run typecheck` beide Projekte grün, Overflow-e2e 4 grün. Der Prüf-Call hängt am Lesen der Einstellungen. `npm start` liest sie, der Standard ist an.
