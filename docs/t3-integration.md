# T3 Code in der Jarvis-App

Stand: 19. Oktober 2026. Quellen sind die öffentlichen Docs und der Server-Code von [pingdotgg/t3code](https://github.com/pingdotgg/t3code), nicht eine laufende Sitzung und kein Token.

## Was T3 lokal anbietet

- Der Server hört standardmäßig auf Port **3773**. `DEFAULT_PORT` steht in `apps/server/src/config.ts`. Die Desktop-App sucht sich den ersten freien Port ab 3773 auf dem Loopback.
- `t3` startet denselben Server und öffnet die lokale Weboberfläche. Eine Loopback-Adresse erreicht nur das Gerät, das den Link öffnet.
- Remote-Zugriff ist ein Opt-in unter **Einstellungen → Verbindungen**: Netzwerkzugriff, Pairing (`t3 pair`), T3 Connect (`t3 connect`) oder Tailscale HTTPS (`t3 serve --tailscale-serve`, `t3 pair --tailscale`). Die Tailscale-Zuordnung bleibt, bis `tailscale serve --https=443 off`. Ein anderer HTTPS-Port geht über `--tailscale-serve-port`.
- Quelle: [docs/user/remote-access.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/remote-access.md).

## Authentifizierung

Eine Umgebung stellt eigene Sitzungen aus. Pairing vergibt begrenzte Rechte. WebSocket- und RPC-Zugriff brauchen eine gepaarte Sitzung (Cookie oder Bearer/DPoP). Ein Relay-Token von T3 Connect ist kein Login.

Der öffentliche Erreichbarkeits-Check, bevor ein Client Zugangsdaten schickt, ist `GET /.well-known/t3/environment`. Jarvis nutzt nur diesen Check: irgendeine Antwort unter 500 gilt als erreichbar. Der Body wird nicht gelesen und nicht gespeichert.

Threads lesen oder schreiben kann ein externer Agent über MCP unter `/mcp`. Dafür ist eine eigene Anmeldung nötig (`claude mcp login`, `codex mcp login` oder die entsprechende Freigabe). Quelle: [docs/user/outside-agents.md](https://github.com/pingdotgg/t3code/blob/main/docs/user/outside-agents.md).

## Entscheidung: Fallback, kein iframe, keine Thread-API

1. **Keine direkte Thread-API.** Es gibt keine dokumentierte Schnittstelle, die ohne Sitzung Threads auflistet oder Nachrichten schickt. MCP wäre echt, verlangt aber Zugangsdaten. Die kommen nicht ins Repo und nicht ins App-Bundle.
2. **Kein iframe.** Einbetten ist keine dokumentierte Integration. Die Oberfläche gehört zu einer gepaarten Sitzung. Jarvis öffnet T3 in einem neuen Tab.
3. **Fallback in der App.** Die Seite T3 zeigt, ob die Basisadresse antwortet, einen Knopf „T3 Code öffnen“ und eine kurze Einrichtung. Das Dashboard-Widget zeigt nur erreichbar oder nicht. Der letzte Thread bleibt in T3.

Die T3-Seite ist eine eigene Swipe-Seite (Kalender, Heute, Aufgaben, Chat, T3). Ein Tab innerhalb des Chats würde dieselbe Fläche doppelt belegen.

## Adresse

`JARVIS_T3_URL` in der Umgebung ist die Vorgabe, standardmäßig `http://127.0.0.1:3773`. Die App darf sie in den Einstellungen überschreiben. Leer heißt: die Vorgabe gilt. Erlaubt sind nur `http` und `https`, ohne Benutzername, Passwort, Query oder Hash. Die gespeicherte Adresse liegt in `data/settings.json` und lokal im Browser, nicht im Bundle.

Fürs Handy im Tailnet die HTTPS-Adresse aus Tailscale Serve eintragen, zum Beispiel `https://<rechner>.<tailnet>.ts.net`. Jarvis richtet `tailscale serve` nicht selbst ein.
