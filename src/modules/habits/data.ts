import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, asc, eq, gte, isNull } from "drizzle-orm";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import type { Habit, HabitLog } from "@/core/db/schema";
import { addDaysKey, todayKey, type DateKey } from "@/lib/dates";
import { isDone, type DayValues } from "./streaks";

const h = schema.habits;
const l = schema.habitLogs;

export interface HabitsData {
  habits: Habit[];
  /** habit id -> date -> value */
  values: Map<string, DayValues>;
}

/** Habits plus their logs for the last `days` days. */
export async function loadHabits(days = 400): Promise<HabitsData> {
  const since = addDaysKey(todayKey(), -days);
  const [habits, logs] = await Promise.all([
    db.select().from(h).where(and(isNull(h.deletedAt), eq(h.archived, false))).orderBy(asc(h.sortOrder), asc(h.createdAt)),
    db.select().from(l).where(and(isNull(l.deletedAt), gte(l.date, since))),
  ]);
  const values = new Map<string, DayValues>();
  for (const log of logs) {
    if (!values.has(log.habitId)) values.set(log.habitId, new Map());
    values.get(log.habitId)!.set(log.date, log.value);
  }
  return { habits, values };
}

export function useHabits() {
  return useQuery({ queryKey: ["habits"], queryFn: () => loadHabits() });
}

function useHabitMutation<A>(fn: (a: A) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["habits"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/** Sets a habit's value for a day; 0 removes the log (soft delete). */
export async function logHabit(habit: Habit, date: DateKey, value: number) {
  const existing: HabitLog | undefined = await db
    .select()
    .from(l)
    .where(and(eq(l.habitId, habit.id), eq(l.date, date)))
    .get();
  if (value <= 0) {
    if (existing && !existing.deletedAt) await db.update(l).set({ deletedAt: Date.now() }).where(eq(l.id, existing.id));
  } else if (existing) {
    await db.update(l).set({ value, deletedAt: null }).where(eq(l.id, existing.id));
  } else {
    await db.insert(l).values({ id: `hl:${habit.id}:${date}`, habitId: habit.id, date, value });
  }
  const key = `${habit.id}:${date}`;
  if (isDone(habit, value)) await recordActivity("habits", date, "habit_logs", key);
  else await clearActivity("habit_logs", key);
}

export function useLogHabit() {
  return useHabitMutation(({ habit, date, value }: { habit: Habit; date: DateKey; value: number }) => logHabit(habit, date, value));
}

export type HabitInput = Pick<Habit, "name" | "color" | "kind" | "target" | "unit" | "schedule" | "reminderTime">;

export function useSaveHabit() {
  return useHabitMutation(async ({ id, ...input }: HabitInput & { id?: string }) => {
    if (id) await db.update(h).set(input).where(eq(h.id, id));
    else await db.insert(h).values({ ...input, startDate: todayKey(), sortOrder: Date.now() });
  });
}

export function useArchiveHabit() {
  return useHabitMutation((id: string) => db.update(h).set({ archived: true }).where(eq(h.id, id)));
}

export function useDeleteHabit() {
  return useHabitMutation((id: string) => db.update(h).set({ deletedAt: Date.now() }).where(eq(h.id, id)));
}
