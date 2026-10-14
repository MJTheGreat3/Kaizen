import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { uuidv7 } from "uuidv7";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "@/core/db/client";
import type { Goal, GoalEntry, GoalLink, Habit, Task } from "@/core/db/schema";
import { todayKey, toKey, type DateKey } from "@/lib/dates";
import { loadActivity } from "@/modules/activity/data";
import { isDone } from "@/modules/habits/streaks";
import { progress, type GoalInputs, type Point, type Progress } from "./logic";

const g = schema.goals;
const gl = schema.goalLinks;
const ge = schema.goalEntries;

export interface GoalView {
  goal: Goal;
  links: GoalLink[];
  entries: GoalEntry[];
  /** Linked habits and tasks that still exist. */
  habits: Habit[];
  tasks: Task[];
  progress: Progress;
}

export async function loadGoals(): Promise<GoalView[]> {
  const [goals, links, entries] = await Promise.all([
    db.select().from(g).where(isNull(g.deletedAt)).orderBy(asc(g.sortOrder), asc(g.createdAt)),
    db.select().from(gl).where(isNull(gl.deletedAt)),
    db.select().from(ge).where(isNull(ge.deletedAt)).orderBy(asc(ge.date), asc(ge.createdAt)),
  ]);
  if (!goals.length) return [];
  const habitIds = links.filter((l) => l.kind === "habit").map((l) => l.refId);
  const taskIds = links.filter((l) => l.kind === "task").map((l) => l.refId);
  const needsActivity = goals.some((x) => x.kind === "activity");
  const needsRatings = goals.some((x) => x.metric?.startsWith("rating:"));
  const [habits, logs, tasks, activity, ratings] = await Promise.all([
    habitIds.length ? db.select().from(schema.habits).where(and(isNull(schema.habits.deletedAt), inArray(schema.habits.id, habitIds))) : [],
    habitIds.length
      ? db
          .select()
          .from(schema.habitLogs)
          .where(and(isNull(schema.habitLogs.deletedAt), inArray(schema.habitLogs.habitId, habitIds)))
      : [],
    taskIds.length ? db.select().from(schema.tasks).where(and(isNull(schema.tasks.deletedAt), inArray(schema.tasks.id, taskIds))) : [],
    needsActivity ? loadActivity() : null,
    needsRatings ? loadRatingSeries() : null,
  ]);
  const today = todayKey();

  return goals.map((goal) => {
    const mine = links.filter((l) => l.goalId === goal.id);
    const myHabits = habits.filter((h) => mine.some((l) => l.kind === "habit" && l.refId === h.id));
    const myTasks = tasks.filter((t) => mine.some((l) => l.kind === "task" && l.refId === t.id));
    const myEntries = entries.filter((e) => e.goalId === goal.id);
    const inputs: GoalInputs = {
      // A goal following a site's rating reads its contest history instead of logged values.
      entries: goal.metric?.startsWith("rating:")
        ? (ratings?.get(goal.metric.slice("rating:".length)) ?? [])
        : myEntries.map((e) => ({ date: e.date, value: e.value })),
      activity:
        activity && goal.activityType
          ? activity.events
              .filter((ev) => ev.typeId === goal.activityType && (!goal.activityTag || activity.tags.get(ev.id)?.includes(goal.activityTag)))
              .map((ev) => ({ date: ev.date, value: ev.quantity }))
          : [],
      checkIns: logs
        .filter((log) => {
          const h = myHabits.find((x) => x.id === log.habitId);
          return h && isDone(h, log.value);
        })
        .map((log) => log.date),
      tasks: myTasks.map((t) => ({ done: t.status === "done", completedOn: t.completedAt ? toKey(new Date(t.completedAt)) : null })),
    };
    return { goal, links: mine, entries: myEntries, habits: myHabits, tasks: myTasks, progress: progress(goal, inputs, today) };
  });
}

/** Rating after each contest per platform, plus today's rating, as goal points. */
async function loadRatingSeries(): Promise<Map<string, Point[]>> {
  const [history, accounts] = await Promise.all([
    db.select().from(schema.cpRatings).orderBy(asc(schema.cpRatings.at)),
    db.select().from(schema.cpAccounts).where(isNull(schema.cpAccounts.deletedAt)),
  ]);
  const out = new Map<string, Point[]>();
  for (const r of history) {
    if (!out.has(r.platform)) out.set(r.platform, []);
    out.get(r.platform)!.push({ date: toKey(new Date(r.at)), value: r.rating });
  }
  for (const a of accounts) {
    if (a.rating === null) continue;
    const points = out.get(a.id) ?? [];
    if (points.at(-1)?.value !== a.rating) points.push({ date: todayKey(), value: a.rating });
    out.set(a.id, points);
  }
  return out;
}

export function useGoals() {
  // Progress comes from other modules, so refresh whenever the page opens.
  return useQuery({ queryKey: ["goals"], queryFn: loadGoals, staleTime: 0 });
}

function useGoalMutation<A>(fn: (a: A) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["goals"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export type GoalInput = Pick<
  Goal,
  "title" | "notes" | "kind" | "unit" | "startValue" | "targetValue" | "startDate" | "targetDate" | "activityType" | "activityTag" | "color" | "metric"
>;

export interface SaveGoal extends GoalInput {
  id?: string;
  habitIds: string[];
  taskIds: string[];
  /** Puts a reached goal back to active. */
  reopen?: boolean;
}

/** Creates or updates a goal and makes its links match the given habits and tasks. */
export async function saveGoal({ id, habitIds, taskIds, reopen, ...input }: SaveGoal): Promise<string> {
  const goalId = id ?? uuidv7();
  if (id) await db.update(g).set(reopen ? { ...input, status: "active", completedAt: null } : input).where(eq(g.id, id));
  else await db.insert(g).values({ id: goalId, ...input, sortOrder: Date.now() });
  const existing = await db.select().from(gl).where(eq(gl.goalId, goalId));
  const wanted = [...habitIds.map((refId) => ({ kind: "habit" as const, refId })), ...taskIds.map((refId) => ({ kind: "task" as const, refId }))];
  for (const link of existing) {
    const keep = wanted.some((w) => w.kind === link.kind && w.refId === link.refId);
    if (keep && link.deletedAt) await db.update(gl).set({ deletedAt: null }).where(eq(gl.id, link.id));
    if (!keep && !link.deletedAt) await db.update(gl).set({ deletedAt: Date.now() }).where(eq(gl.id, link.id));
  }
  for (const w of wanted) {
    if (existing.some((l) => l.kind === w.kind && l.refId === w.refId)) continue;
    // Derived ids so the same link made on two devices syncs as one.
    await db.insert(gl).values({ id: `gl:${goalId}:${w.kind}:${w.refId}`, goalId, ...w }).onConflictDoUpdate({
      target: gl.id,
      set: { deletedAt: null, updatedAt: Date.now() },
    });
  }
  return goalId;
}

export function useSaveGoal() {
  return useGoalMutation(saveGoal);
}

export async function setGoalStatus(id: string, status: Goal["status"]) {
  await db
    .update(g)
    .set({ status, completedAt: status === "done" ? Date.now() : null })
    .where(eq(g.id, id));
}

export function useGoalStatus() {
  return useGoalMutation(({ id, status }: { id: string; status: Goal["status"] }) => setGoalStatus(id, status));
}

export function useDeleteGoal() {
  return useGoalMutation((id: string) => db.update(g).set({ deletedAt: Date.now() }).where(eq(g.id, id)));
}

export function useLogEntry() {
  return useGoalMutation(({ goalId, date, value, note }: { goalId: string; date: DateKey; value: number; note?: string | null }) =>
    db.insert(ge).values({ goalId, date, value, note: note ?? null }),
  );
}

export function useDeleteEntry() {
  return useGoalMutation((id: string) => db.update(ge).set({ deletedAt: Date.now() }).where(eq(ge.id, id)));
}

/** Habits and open-or-recent tasks offered when linking. */
export async function loadLinkOptions() {
  const [habits, tasks, activity, accounts] = await Promise.all([
    db
      .select()
      .from(schema.habits)
      .where(and(isNull(schema.habits.deletedAt), eq(schema.habits.archived, false)))
      .orderBy(asc(schema.habits.sortOrder)),
    db
      .select()
      .from(schema.tasks)
      .where(and(isNull(schema.tasks.deletedAt), eq(schema.tasks.list, "todo"))),
    loadActivity(),
    db.select().from(schema.cpAccounts).where(isNull(schema.cpAccounts.deletedAt)),
  ]);
  return { habits, tasks, types: activity.types, tags: activity.allTags, accounts };
}

export function useLinkOptions(enabled: boolean) {
  return useQuery({ queryKey: ["goal-options"], queryFn: loadLinkOptions, enabled });
}
