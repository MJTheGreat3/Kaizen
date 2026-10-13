import { startOfISOWeek } from "date-fns";

import type { HabitSchedule } from "@/core/db/schema";
import { addDaysKey, fromKey, isoWeekday, toKey, type DateKey } from "@/lib/dates";

export interface HabitLike {
  kind: "check" | "count";
  target: number;
  schedule: HabitSchedule;
  startDate: DateKey;
}

/** Value logged per day. */
export type DayValues = Map<DateKey, number>;

export function isDone(habit: HabitLike, value: number | undefined): boolean {
  return (value ?? 0) >= (habit.kind === "check" ? 1 : habit.target);
}

/** Whether the habit is expected on this day (weekly habits: every day counts). */
export function isScheduled(habit: HabitLike, day: DateKey): boolean {
  if (day < habit.startDate) return false;
  return habit.schedule.type === "weekdays" ? habit.schedule.days.includes(isoWeekday(day)) : true;
}

function weekStart(day: DateKey): DateKey {
  return toKey(startOfISOWeek(fromKey(day)));
}

export interface StreakInfo {
  current: number;
  best: number;
  /** "days" for daily/weekday habits, "weeks" for N-per-week habits. */
  unit: "days" | "weeks";
}

/**
 * Current and best streaks. A scheduled day (or week) that is still in
 * progress doesn't break the current streak until it's over.
 */
export function streaks(habit: HabitLike, values: DayValues, today: DateKey): StreakInfo {
  if (habit.schedule.type === "weekly") return weeklyStreaks(habit, habit.schedule.times, values, today);

  let current = 0;
  let best = 0;
  let run = 0;
  let currentSettled = false;
  for (let day = habit.startDate; day <= today; day = addDaysKey(day, 1)) {
    if (!isScheduled(habit, day)) continue;
    if (isDone(habit, values.get(day))) {
      run++;
    } else if (day !== today) {
      run = 0;
    }
    best = Math.max(best, run);
  }
  // Walk back from today for the current streak.
  for (let day = today; day >= habit.startDate && !currentSettled; day = addDaysKey(day, -1)) {
    if (!isScheduled(habit, day)) continue;
    if (isDone(habit, values.get(day))) current++;
    else if (day !== today) currentSettled = true;
  }
  return { current, best: Math.max(best, current), unit: "days" };
}

function weeklyStreaks(habit: HabitLike, times: number, values: DayValues, today: DateKey): StreakInfo {
  const perWeek = new Map<DateKey, number>();
  for (const [day, value] of values) {
    if (day < habit.startDate || day > today || !isDone(habit, value)) continue;
    const w = weekStart(day);
    perWeek.set(w, (perWeek.get(w) ?? 0) + 1);
  }
  const thisWeek = weekStart(today);
  let best = 0;
  let run = 0;
  for (let w = weekStart(habit.startDate); w <= thisWeek; w = addDaysKey(w, 7)) {
    if ((perWeek.get(w) ?? 0) >= times) run++;
    else if (w !== thisWeek) run = 0;
    best = Math.max(best, run);
  }
  let current = 0;
  for (let w = thisWeek; w >= weekStart(habit.startDate); w = addDaysKey(w, -7)) {
    if ((perWeek.get(w) ?? 0) >= times) current++;
    else if (w !== thisWeek) break;
  }
  return { current, best: Math.max(best, current), unit: "weeks" };
}

/** Times done this week, for N-per-week habits. */
export function doneThisWeek(habit: HabitLike, values: DayValues, today: DateKey): number {
  const start = weekStart(today);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = addDaysKey(start, i);
    if (day <= today && isDone(habit, values.get(day))) count++;
  }
  return count;
}

/** Share of scheduled days completed over the last `days` days. */
export function completionRate(habit: HabitLike, values: DayValues, today: DateKey, days = 30): number {
  let scheduled = 0;
  let done = 0;
  for (let i = 0; i < days; i++) {
    const day = addDaysKey(today, -i);
    if (!isScheduled(habit, day)) continue;
    if (day === today && !isDone(habit, values.get(day))) continue;
    scheduled++;
    if (isDone(habit, values.get(day))) done++;
  }
  return scheduled ? done / scheduled : 0;
}
