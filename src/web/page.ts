export function renderHomePage(): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Jarvis</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.45 system-ui, sans-serif; margin: 0; background: #111; color: #f4f4f5; }
    main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
    h1 { font-size: 1.5rem; margin: 0 0 4px; }
    h2 { font-size: 1rem; margin: 0 0 12px; }
    .lead { color: #a1a1aa; margin: 0 0 20px; }
    section { margin-top: 28px; }
    #log { min-height: 200px; border: 1px solid #333; border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
    .bubble { padding: 8px 12px; border-radius: 12px; max-width: 85%; white-space: pre-wrap; }
    .user { align-self: flex-end; background: #1d4ed8; }
    .jarvis { align-self: flex-start; background: #27272a; }
    form { display: flex; gap: 8px; margin-top: 12px; }
    input, button { font: inherit; }
    input { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid #3f3f46; background: #18181b; color: inherit; }
    button { padding: 8px 12px; border-radius: 10px; border: 0; background: #e4e4e7; color: #111; cursor: pointer; }
    button:disabled { opacity: 0.45; cursor: default; }
    ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
    li { border: 1px solid #333; border-radius: 12px; padding: 12px; }
    .titel { font-weight: 600; }
    .meta { color: #a1a1aa; font-size: 0.85rem; margin-top: 4px; }
    .actions { display: flex; gap: 8px; margin-top: 10px; }
    .error { color: #fca5a5; min-height: 1.2em; }
    .empty { color: #a1a1aa; }
  </style>
</head>
<body>
  <main>
    <h1>Jarvis</h1>
    <p class="lead">Chat und Aufgaben, nur auf diesem Rechner.</p>
    <section>
      <h2>Chat</h2>
      <div id="log" aria-live="polite"></div>
      <form id="chat">
        <input id="message" name="message" autocomplete="off" placeholder="Was steht an?" required>
        <button type="submit" id="send">Senden</button>
      </form>
    </section>
    <section>
      <h2>Aufgaben</h2>
      <p id="tasks-error" class="error"></p>
      <ul id="tasks"></ul>
    </section>
    <section>
      <h2>Offene Punkte</h2>
      <p id="notes-error" class="error"></p>
      <ul id="notes"></ul>
    </section>
  </main>
  <script>
    const log = document.querySelector("#log");
    const form = document.querySelector("#chat");
    const input = document.querySelector("#message");
    const send = document.querySelector("#send");
    const tasksEl = document.querySelector("#tasks");
    const tasksError = document.querySelector("#tasks-error");
    const notesEl = document.querySelector("#notes");
    const notesError = document.querySelector("#notes-error");

    function esc(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]);
    }

    function addBubble(role, text) {
      const item = document.createElement("div");
      item.className = "bubble " + role;
      item.textContent = text;
      log.appendChild(item);
      log.scrollTop = log.scrollHeight;
    }

    function renderTasks(tasks) {
      if (!tasks.length) {
        tasksEl.innerHTML = '<li class="empty">keine Aufgaben</li>';
        return;
      }
      tasksEl.innerHTML = tasks.map((task) => {
        const due = task.faelligAm ? " · bis " + esc(task.faelligAm) : "";
        const canComplete = task.status === "offen" || task.status === "fehlgeschlagen";
        const canReset = task.status === "in Arbeit";
        return '<li data-id="' + esc(task.id) + '">' +
          '<div class="titel">' + esc(task.titel) + '</div>' +
          '<div class="meta">' + esc(task.status) + " · " + esc(task.id) + due + '</div>' +
          '<div class="actions">' +
            '<button type="button" data-action="complete"' + (canComplete ? "" : " disabled") + '>abhaken</button>' +
            '<button type="button" data-action="reset"' + (canReset ? "" : " disabled") + '>zurücksetzen</button>' +
          '</div>' +
        '</li>';
      }).join("");
    }

    async function loadTasks() {
      const response = await fetch("/api/tasks");
      const data = await response.json();
      if (!response.ok) {
        tasksError.textContent = data.error || "Aufgaben konnten nicht geladen werden.";
        return;
      }
      tasksError.textContent = "";
      renderTasks(data.tasks || []);
    }

    function renderNotes(notes) {
      if (!notes.length) {
        notesEl.innerHTML = '<li class="empty">keine offenen Punkte</li>';
        return;
      }
      notesEl.innerHTML = notes.map((note) => {
        const who = note.person ? esc(note.person) + ": " : "";
        const due = note.erinnernAm ? " · erinnern " + esc(note.erinnernAm) : "";
        return '<li data-id="' + esc(note.id) + '">' +
          '<div class="titel">' + who + esc(note.text) + '</div>' +
          '<div class="meta">' + esc(note.id) + due + '</div>' +
          '<div class="actions"><button type="button" data-action="close">schließen</button></div>' +
        '</li>';
      }).join("");
    }

    async function loadNotes() {
      const response = await fetch("/api/notes");
      const data = await response.json();
      if (!response.ok) {
        notesError.textContent = data.error || "Notizen konnten nicht geladen werden.";
        return;
      }
      notesError.textContent = "";
      renderNotes(data.notes || []);
    }

    tasksEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const item = button.closest("[data-id]");
      const id = item?.getAttribute("data-id");
      const action = button.getAttribute("data-action");
      if (!id || !action) return;
      button.disabled = true;
      const response = await fetch("/api/tasks/" + encodeURIComponent(id) + "/" + action, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        tasksError.textContent = data.error || "Das hat nicht geklappt.";
      }
      await loadTasks();
    });

    notesEl.addEventListener("click", async (event) => {
      const button = event.target.closest("button[data-action='close']");
      if (!button) return;
      const item = button.closest("[data-id]");
      const id = item?.getAttribute("data-id");
      if (!id) return;
      button.disabled = true;
      const response = await fetch("/api/notes/" + encodeURIComponent(id) + "/close", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        notesError.textContent = data.error || "Das hat nicht geklappt.";
      }
      await loadNotes();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      addBubble("user", text);
      send.disabled = true;
      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        const data = await response.json();
        addBubble("jarvis", response.ok ? data.reply : (data.error || "Das hat nicht geklappt."));
        await loadTasks();
        await loadNotes();
      } catch {
        addBubble("jarvis", "Der Server antwortet nicht.");
      } finally {
        send.disabled = false;
        input.focus();
      }
    });

    loadTasks().catch(() => {
      tasksError.textContent = "Aufgaben konnten nicht geladen werden.";
    });
    loadNotes().catch(() => {
      notesError.textContent = "Notizen konnten nicht geladen werden.";
    });
  </script>
</body>
</html>
`;
}
