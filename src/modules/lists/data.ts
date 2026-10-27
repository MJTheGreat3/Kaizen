import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import type { Task, TaskList } from "@/core/db/schema";
import type { ParsedTask } from "@/core/nl/parse";
import { todayKey } from "@/lib/dates";
import { ipc } from "@/lib/ipc";
import { exactMatch, metaFrom } from "./details";
import { nextDue } from "./recurrence";
import { ancestors, buildTree, descendants } from "./subtasks";

const t = schema.tasks;

export async function loadTasks(list?: TaskList): Promise<Task[]> {
  const where = list ? and(isNull(t.deletedAt), eq(t.list, list)) : isNull(t.deletedAt);
  return db.select().from(t).where(where).orderBy(desc(t.createdAt));
}

export function useTasks(list?: TaskList) {
  return useQuery({ queryKey: ["tasks", list ?? "all"], queryFn: () => loadTasks(list) });
}

/** Mutation that refreshes task lists and the Today page afterwards. */
function useTaskMutation<A>(fn: (arg: A) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["tasks"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/**
 * Looks up a new book or title and fills in its details when the match is
 * clear (same title). Offline or unclear, the item is left as typed.
 */
async function fillDetails(id: string, list: "read" | "watch", title: string): Promise<boolean> {
  try {
    const match = exactMatch(await ipc.mediaSearch(list, title), title);
    if (!match) return false;
    const [row] = await db.select({ meta: t.meta }).from(t).where(eq(t.id, id));
    if (!row || row.meta.sourceId) return false;
    await db
      .update(t)
      .set({ meta: metaFrom(match, row.meta) })
      .where(eq(t.id, id));
    return true;
  } catch {
    return false;
  }
}

export function useAddTask() {
  const client = useQueryClient();
  return useTaskMutation(async (p: ParsedTask & { notes?: string | null; remind?: boolean; parentId?: string | null }) => {
    const [created] = await db
      .insert(t)
      .values({
        // Subtasks are always to-dos.
        list: p.parentId ? "todo" : p.list,
        parentId: p.parentId ?? null,
        title: p.title,
        notes: p.notes ?? null,
        dueDate: p.dueDate,
        dueTime: p.dueTime,
        remind: p.remind ?? !!p.dueTime,
        recurrence: p.recurrence,
        priority: p.priority,
        tags: p.tags,
      })
      .returning({ id: t.id });
    if (created && p.list !== "todo" && !p.parentId) {
      void fillDetails(created.id, p.list, p.title).then((filled) => {
        if (filled) client.invalidateQueries({ queryKey: ["tasks"] });
      });
    }
  });
}

export function useUpdateTask() {
  return useTaskMutation(({ id, ...patch }: Partial<Task> & { id: string }) =>
    db.update(t).set(patch).where(eq(t.id, id)),
  );
}

/** The live to-dos, as a subtask tree. */
async function loadTree() {
  const all = await loadTasks("todo");
  return { tree: buildTree(all), byId: new Map(all.map((x) => [x.id, x])) };
}

/** Deletes a task with its subtasks. */
export function useDeleteTask() {
  return useTaskMutation(async (id: string) => {
    const { tree } = await loadTree();
    const ids = [id, ...descendants(id, tree.children).map((x) => x.id)];
    await db.update(t).set({ deletedAt: Date.now() }).where(inArray(t.id, ids));
    for (const each of ids) await clearActivity("tasks", each);
  });
}

/**
 * Completes or reopens a task. Completing one completes its open subtasks;
 * reopening one reopens the tasks above it. Completing a recurring task
 * schedules the next one, with fresh copies of its subtasks.
 */
export async function setTaskDone(task: Task, done: boolean) {
  const today = todayKey();
  const { tree, byId } = task.list === "todo" ? await loadTree() : { tree: buildTree([]), byId: new Map<string, Task>() };
  if (done) {
    const now = Date.now();
    await db.update(t).set({ status: "done", completedAt: now }).where(eq(t.id, task.id));
    if (task.list === "todo") await recordActivity("tasks", today, "tasks", task.id);
    const open = descendants(task.id, tree.children)
      .filter((x) => x.status !== "done")
      .map((x) => x.id);
    if (open.length) await db.update(t).set({ status: "done", completedAt: now }).where(inArray(t.id, open));
    if (task.recurrence) {
      const [next] = await db
        .insert(t)
        .values({
          list: task.list,
          parentId: task.parentId,
          title: task.title,
          notes: task.notes,
          dueDate: nextDue(task.recurrence, task.dueDate, today),
          dueTime: task.dueTime,
          remind: task.remind,
          recurrence: task.recurrence,
          priority: task.priority,
          tags: task.tags,
        })
        .returning({ id: t.id });
      if (next) await copySubtasks(task.id, next.id, tree.children);
    }
  } else {
    const reopen = [task, ...ancestors(task, byId).filter((x) => x.status === "done")];
    await db
      .update(t)
      .set({ status: task.list === "todo" ? "open" : "in_progress", completedAt: null })
      .where(inArray(t.id, reopen.map((x) => x.id)));
    for (const each of reopen) await clearActivity("tasks", each.id);
  }
}

/** Copies the subtasks under `from` to `to`, all open. */
async function copySubtasks(from: string, to: string, children: Map<string, Task[]>) {
  for (const c of children.get(from) ?? []) {
    const [copy] = await db
      .insert(t)
      .values({ list: c.list, parentId: to, title: c.title, notes: c.notes, priority: c.priority, tags: c.tags })
      .returning({ id: t.id });
    if (copy) await copySubtasks(c.id, copy.id, children);
  }
}

export function useSetDone() {
  return useTaskMutation(({ task, done }: { task: Task; done: boolean }) => setTaskDone(task, done));
}
