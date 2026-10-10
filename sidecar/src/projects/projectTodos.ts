import { randomUUID } from 'node:crypto';
import type { Project, ProjectTodo } from './types.js';
import { hasUndeliveredReport, type ProjectInbox } from './projectInbox.js';
import type { ProjectWakeQueue } from './ProjectWakeQueue.js';
import { LEDGER_LIMITS } from './store.js';

/** Owns lead follow-ups and their single restart-safe reminder timer. */
export class ProjectTodos {
  private timer?: NodeJS.Timeout;
  private started = false;
  private closed = false;
  constructor(
    private readonly projects: Map<string, Project>,
    private readonly inbox: ProjectInbox,
    private readonly wakes: ProjectWakeQueue,
    private readonly persist: () => Promise<void>,
  ) {}
  start(): void {
    this.started = true;
    this.arm();
  }
  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  async add(
    project: Project,
    input: { text: string; after?: string; inMinutes?: number; at?: string },
  ): Promise<Omit<ProjectTodo, 'notified'>> {
    const text = input.text.trim();
    if (!text || text.length > LEDGER_LIMITS.todoText)
      throw new Error(`To-dos must contain 1 to ${String(LEDGER_LIMITS.todoText)} characters.`);
    if (
      input.inMinutes !== undefined &&
      (!Number.isInteger(input.inMinutes) || input.inMinutes < 1 || input.inMinutes > 1440)
    )
      throw new Error('inMinutes must be a whole number from 1 to 1440.');
    if (input.at !== undefined && input.inMinutes !== undefined)
      throw new Error('Choose at or inMinutes for the reminder time, not both.');
    const at = input.at === undefined ? undefined : Date.parse(input.at);
    if (
      at !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.at ?? '') ||
        !Number.isFinite(at) ||
        at <= Date.now())
    )
      throw new Error('at must be a future ISO timestamp with a timezone.');
    if (project.todos.length >= LEDGER_LIMITS.todos)
      throw new Error(
        `This project already has ${String(LEDGER_LIMITS.todos)} open to-dos. Use todo_done before adding another.`,
      );
    const after = input.after;
    const todo: ProjectTodo = {
      id: randomUUID(),
      text,
      ...(after ? { after } : {}),
      ...(at !== undefined ? { dueAt: at } : {}),
      ...(input.inMinutes !== undefined ? { dueAt: Date.now() + input.inMinutes * 60_000 } : {}),
    };
    if (after && hasUndeliveredReport(project, after)) todo.due = true;
    project.todos.push(todo);
    delete project.done;
    await this.persist();
    if (todo.due) this.wakes.kick(project);
    const result = { ...todo };
    delete result.notified;
    return result;
  }

  async done(project: Project, id: string): Promise<void> {
    if (!project.todos.some((todo) => todo.id === id))
      throw new Error('No open to-do has that id in this project.');
    project.todos = project.todos.filter((todo) => todo.id !== id);
    project.pending = project.pending.filter((message) => message.id !== id);
    // A reminder already claimed by a delivery leaves that batch too, so a
    // refused or busy delivery cannot put it back.
    const claimed = project.delivery?.messages;
    const index = claimed?.findIndex((message) => message.id === id) ?? -1;
    if (index >= 0) claimed?.splice(index, 1);
    // A claim with nothing left in it is settled.
    if (claimed?.length === 0) delete project.delivery;
    await this.persist();
  }

  arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.closed || !this.started) return;
    let nextDueAt = Infinity;
    for (const project of this.projects.values())
      for (const todo of project.todos)
        if (!todo.due && todo.dueAt !== undefined) nextDueAt = Math.min(nextDueAt, todo.dueAt);
    if (nextDueAt === Infinity) return;
    this.timer = setTimeout(
      () => {
        this.timer = undefined;
        void this.wakeDueTodos().catch((error: unknown) => {
          console.error('Could not persist project follow-ups:', error);
        });
      },
      Math.min(2_147_483_647, Math.max(0, nextDueAt - Date.now())),
    );
    this.timer.unref();
  }

  private async wakeDueTodos(): Promise<void> {
    if (this.closed) return;
    const dueProjects: Project[] = [];
    const now = Date.now();
    for (const project of this.projects.values()) {
      let changed = false;
      for (const todo of project.todos) {
        if (todo.due || todo.dueAt === undefined || todo.dueAt > now) continue;
        todo.due = true;
        changed = true;
      }
      if (changed) {
        this.inbox.refill(project);
        dueProjects.push(project);
      }
    }
    await this.persist();
    for (const project of dueProjects)
      if (this.projects.get(project.id) === project) this.wakes.kick(project);
  }
}
