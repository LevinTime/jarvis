# Design-System

Eine Richtung, nicht drei Frameworks übereinander. Jarvis ist ein Werkzeug (Operate): scannen, tippen, fertig. Die Marke bleibt Midnight, Blau auf fast Schwarz, Violett nur als Zustand.

Quellen, nur die Teile, die hier gelten:

- Emil Kowalski, [Great Animations](https://emilkowal.ski/ui/great-animations) und die Animate-Skill: Bewegung hat einen Zweck. Eintritt `ease-out`, Verschieben `ease-in-out`, Hover `ease`, Dauerbewegung `linear`. UI unter 300 ms. Nur `transform` und `opacity`. `prefers-reduced-motion` lässt Deckkraft und Farbe, streicht Schweben und Puls.
- Taste Skill, App-Screens: ruhige Flächen, Farbe an Zustand und Zahl, keine Glow-Kulisse, keine Versalien-Labels, keine Glaskarten.
- Impeccable, Modus Operate: eine Hierarchie, Kontrast nach WCAG AA, Fokus und Ziele von mindestens 44 px.

## Kritik des Ist-Zustands

Aufgenommen vor dieser Runde. Bilder: `docs/screenshots/design-v2/vorher/`.

- Der Kopf konkurriert. Gruß, Datum, Fehlerzahl, Orb, Anordnen, Einstellungen und Live stehen in einer Zeile. Auf 428 px bricht der Name um, der Orb sitzt als kleiner Fleck dazwischen.
- Der Orb unterscheidet Zustände kaum. Idle, Zuhören, Denken und Sprechen teilen sich denselben blau-violetten Fleck. Der Unterschied ist vor allem die Animationsdauer. Einen Fehler-Zustand gibt es nicht. Das Bild `428x926-orb-error` sieht aus wie Idle.
- Der Zustand steht nur für Screenreader im Orb. Sehend fehlt der Name.
- `prefers-reduced-motion` setzt `animation` und `transition` auf alles auf null. Damit fallen auch die Deckkraft-Übergänge weg, die bleiben sollen.
- Die Fläche ist die übliche Assistenten-Kulisse: radialer Glow, Glaskarten mit Schlagschatten, Inter in der Schriftliste, Labels in gesperrten Versalien (`TERMINE`, `CHAT`).
- Auf dem Handy bricht die Chat-Kachel, weil Label und Text in einer Zeile stehen (`CHAT` / `AT`).
- Abstände mischen 10, 14 und 20. Die Typo hat drei Größen und keine benannte Skala.
- Was schon trägt: Fokusring über `:focus-visible`, viele Ziele mit 44 px, Andocken unten, kein Kostenblock auf Heute.

Kontrast der bisherigen Midnight-Farben auf `#07070f` liegt über 4,5:1 (Text `#f4f6ff` 18,6:1, gedämpft `#b7c0d8` 11:1, Akzent `#4f7cff` 5,4:1, Violett `#8b5cf6` 4,7:1). Die Farben bleiben. Die Verteilung ändert sich.

## Richtung

Ruhiger Schreibtisch. Eine Schrift der Systemfamilie, ohne Inter. Flächen ohne Glow und ohne Milchglas. Farbe zeigt Zustand: Blau ist Ruhe und Aktion, helles Blau ist Zuhören, Violett ist Denken, helles Violett ist Sprechen, Rot ist Fehler. Der Name des Zustands steht unter dem Orb.

## Tokens

Fünf Schriftstufen, nicht mehr:

| Token | Größe | Gebrauch |
| --- | --- | --- |
| `--type-meta` | 0.75rem | Zustand, Meta |
| `--type-label` | 0.875rem | Labels, Datum |
| `--type-body` | 1rem | Text |
| `--type-title` | 1.25rem | Kachel- und Seitentitel |
| `--type-display` | 1.5rem | Gruß auf Heute |

`--text-sm`, `--text-md` und `--text-lg` zeigen auf Label, Body und Titel, damit bestehende Regeln mitziehen.

Abstand, Vielfache von 4: `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32, `--space-7` 48. Dichte behält die geprüften Werte (`--row` 40 / 36 / 52).

Farbe, Midnight:

| Token | Wert | Rolle |
| --- | --- | --- |
| `--bg` | `#07070f` | Grund, nicht reines Schwarz |
| `--fg` | `#f4f6ff` | Text |
| `--muted` | `#b7c0d8` | zweiter Text |
| `--faint` | `#8b95b2` | Meta, 6,7:1 |
| `--accent` | `#4f7cff` | Aktion, Idle |
| `--listen` | `#7ee7ff` | Zuhören |
| `--accent-2` | `#8b5cf6` | Denken |
| `--speak` | `#d4c4ff` | Sprechen |
| `--danger` | `#f08b7c` | Fehler |
| `--ok` | `#8ed7b0` | in Ordnung |
| `--warn` | `#e7c36a` | Hinweis |

Bewegung, Kurven aus der Animate-Skill:

| Token | Wert | Wann |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Erscheinen, Antwort |
| `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Verschieben auf dem Schirm |
| `--ease` | `cubic-bezier(0.25, 0.1, 0.25, 1)` | Hover, Farbe |
| `--dur-press` | 140ms | Tastendruck |
| `--dur-fast` | 180ms | kleine Fläche |
| `--dur` | 220ms | Wechsel, Leiste |
| `--dur-slow` | 280ms | Fläche, die bleibt |

Dauerbewegung (Denk-Ring) ist `linear` und kein Übergang, deshalb länger als 300 ms. Idle atmet nur über Deckkraft, 7 s, weil der Orb den ganzen Tag sichtbar ist.

Bei `prefers-reduced-motion` und bei `data-motion="reduce"`: keine Animation. Übergänge nur für Deckkraft und Farbe, 200 ms, `--ease-out`.

## Orb

| Zustand | Farbe | Bewegung | Text |
| --- | --- | --- | --- |
| idle | Blau | langsame Deckkraft | Jarvis ist ruhig |
| listening | Hellblau | Ring in Deckkraft, Pegel nur als `scale` | Jarvis hört zu |
| thinking | Violett | Ring dreht linear | Jarvis denkt nach |
| speaking | Helles Violett | schnellere Deckkraft | Jarvis spricht |
| error | Rot | still | Jarvis hat einen Fehler |

Der sichtbare Name ist `aria-hidden`. Die Live-Region ist `polite`, bei Fehler `assertive`. `?orb=idle|listening|thinking|speaking|error` setzt den Zustand für Aufnahmen. Auf Heute ist der Orb die Bühne (`is-hero`): 148 px, ab 900 px 240 px, mit zwei stillen Ringen. Der kleine Orb bleibt 72 px.

## Heute

Zwei Konzeptbilder, eine Richtung. Die Fläche bleibt fast schwarz, ohne Gitter und ohne Milchglas. Die Karten sind nur ein 1-px-Rand, damit Termine und Aufgaben lesbar bleiben. Eine helle Pille markiert den heutigen Tag. Das Mikrofon ist hell, solange keine Spracheingabe existiert: es setzt den Fokus ins Feld, und mit Text wird daraus Senden.

Daten sind echt. Die Woche kommt aus Berlin, ein Punkt heißt ein offener Termin an dem Tag, ein Tippen öffnet den Kalender. Heute listet Aufgaben mit Uhrzeit von heute. Aufgaben daneben sind die übrigen offenen, die Box setzt sie auf erledigt. Der Punkt daneben ist die Verbindung (`live`, `verbinde`, `offline`). Wetter und Beispielnamen gibt es nicht. Notizen, Gedächtnis und Anordnen bleiben unter dem Feld.

## Fokus und Touch

`:focus-visible` bleibt 2 px im Akzent, Versatz 3 px. Klickflächen mindestens 44 px, auch die Segment-Schalter und die Wochentage.
