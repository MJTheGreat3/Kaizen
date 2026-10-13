import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, desc, eq, isNull } from "drizzle-orm";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import type { Task, TaskList } from "@/core/db/schema";
import type { ParsedTask } from "@/core/nl/parse";
import { todayKey } from "@/lib/dates";
import { nextDue } from "./recurrence";

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

export function useAddTask() {
  return useTaskMutation((p: ParsedTask & { notes?: string | null; remind?: boolean }) =>
    db.insert(t).values({
      list: p.list,
      title: p.title,
      notes: p.notes ?? null,
      dueDate: p.dueDate,
      dueTime: p.dueTime,
      remind: p.remind ?? !!p.dueTime,
      recurrence: p.recurrence,
      priority: p.priority,
      tags: p.tags,
    }),
  );
}

export function useUpdateTask() {
  return useTaskMutation(({ id, ...patch }: Partial<Task> & { id: string }) =>
    db.update(t).set(patch).where(eq(t.id, id)),
  );
}

export function useDeleteTask() {
  return useTaskMutation(async (id: string) => {
    await db.update(t).set({ deletedAt: Date.now() }).where(eq(t.id, id));
    await clearActivity("tasks", id);
  });
}

/** Completes or reopens a task. Completing a recurring task schedules the next one. */
export async function setTaskDone(task: Task, done: boolean) {
  const today = todayKey();
  if (done) {
    await db.update(t).set({ status: "done", completedAt: Date.now() }).where(eq(t.id, task.id));
    if (task.list === "todo") await recordActivity("tasks", today, "tasks", task.id);
    if (task.list === "read") await recordActivity("reading", today, "tasks", task.id);
    if (task.recurrence) {
      await db.insert(t).values({
        list: task.list,
        title: task.title,
        notes: task.notes,
        dueDate: nextDue(task.recurrence, task.dueDate, today),
        dueTime: task.dueTime,
        remind: task.remind,
        recurrence: task.recurrence,
        priority: task.priority,
        tags: task.tags,
      });
    }
  } else {
    await db
      .update(t)
      .set({ status: task.list === "todo" ? "open" : "in_progress", completedAt: null })
      .where(eq(t.id, task.id));
    await clearActivity("tasks", task.id);
  }
}

export function useSetDone() {
  return useTaskMutation(({ task, done }: { task: Task; done: boolean }) => setTaskDone(task, done));
}
