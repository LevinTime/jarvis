import type { EventBus } from "./events.ts";
import type { NoteService } from "./notes/service.ts";
import type { TaskService } from "./tasks/service.ts";

export function observeTasks(tasks: TaskService, events: EventBus): TaskService {
  return {
    ...tasks,
    async create(input) {
      const task = await tasks.create(input);
      events.emit({ type: "task:changed", action: "created", taskId: task.id, task });
      return task;
    },
    async run(id) {
      const before = new Set((await tasks.list()).map((task) => task.id));
      const task = await tasks.run(id);
      events.emit({ type: "task:changed", action: "updated", taskId: task.id, task });
      for (const next of await tasks.list()) {
        if (!before.has(next.id)) {
          events.emit({ type: "task:changed", action: "created", taskId: next.id, task: next });
        }
      }
      return task;
    },
    async reset(id) {
      const task = await tasks.reset(id);
      events.emit({ type: "task:changed", action: "updated", taskId: task.id, task });
      return task;
    },
    async update(id, patch) {
      const before = new Set((await tasks.list()).map((task) => task.id));
      const task = await tasks.update(id, patch);
      events.emit({ type: "task:changed", action: "updated", taskId: task.id, task });
      for (const next of await tasks.list()) {
        if (!before.has(next.id)) {
          events.emit({ type: "task:changed", action: "created", taskId: next.id, task: next });
        }
      }
      return task;
    },
    async remove(id) {
      await tasks.remove(id);
      events.emit({ type: "task:changed", action: "deleted", taskId: id });
    },
  };
}

export function observeNotes(notes: NoteService, events: EventBus): NoteService {
  return {
    ...notes,
    async add(input) {
      const note = await notes.add(input);
      events.emit({ type: "note:changed", action: "added", noteId: note.id, note });
      return note;
    },
    async close(id) {
      const note = await notes.close(id);
      events.emit({ type: "note:changed", action: "closed", noteId: note.id, note });
      return note;
    },
  };
}
