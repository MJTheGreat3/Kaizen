/**
 * Pure goal progress maths. Each kind reads a different source (logged
 * values, activity totals, habit check-ins, linked tasks), but all end up as
 * a series of values from `start` towards `target`.
 */
import type { Goal } from "@/core/db/schema";
import { daysBetween, type DateKey } from "@/lib/dates";

export interface Point {
  date: DateKey;
  value: number;
}

export interface GoalInputs {
  /** Manual goals: logged values. */
  entries: Point[];
  /** Activity goals: matching events (already filtered by type and tag). */
  activity: Point[];
  /** Habit goals: days each linked habit was done, one point per check-in. */
  checkIns: DateKey[];
  /** Task goals: linked tasks and whether each is done. */
  tasks: { done: boolean; completedOn: DateKey | null }[];
}

export type Pace = "done" | "ahead" | "on_track" | "behind" | "overdue" | "none";

export interface Progress {
  start: number;
  current: number;
  target: number;
  /** 0..1 */
  fraction: number;
  /** Values over time, for the chart. */
  series: Point[];
  pace: Pace;
  /** Where the value should be today to finish on time, if there is a target date. */
  expected: number | null;
  daysLeft: number | null;
  /** Additive goals: what is still needed per day to finish on time. */
  perDay: number | null;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Running total of points per day, from `from`. */
export function cumulative(points: Point[], from: DateKey): Point[] {
  const byDay = new Map<DateKey, number>();
  for (const p of points) if (p.date >= from) byDay.set(p.date, (byDay.get(p.date) ?? 0) + p.value);
  let total = 0;
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, value: (total += v) }));
}

type GoalShape = Pick<Goal, "kind" | "startValue" | "targetValue" | "startDate" | "targetDate" | "status">;

export function progress(goal: GoalShape, inputs: GoalInputs, today: DateKey): Progress {
  let start = 0;
  let target = goal.targetValue;
  let series: Point[];
  switch (goal.kind) {
    case "manual":
      start = goal.startValue;
      series = [...inputs.entries].filter((p) => p.date >= goal.startDate).sort((a, b) => a.date.localeCompare(b.date));
      break;
    case "activity":
      series = cumulative(inputs.activity, goal.startDate);
      break;
    case "habits":
      series = cumulative(
        inputs.checkIns.map((date) => ({ date, value: 1 })),
        goal.startDate,
      );
      break;
    case "tasks":
      target = inputs.tasks.length;
      series = cumulative(
        inputs.tasks.filter((t) => t.done && t.completedOn).map((t) => ({ date: t.completedOn!, value: 1 })),
        goal.startDate,
      );
      break;
  }
  const current = series.at(-1)?.value ?? start;
  const span = target - start;
  const fraction = span === 0 ? (current === target ? 1 : 0) : clamp((current - start) / span);

  let expected: number | null = null;
  let daysLeft: number | null = null;
  let perDay: number | null = null;
  let pace: Pace = "none";
  if (goal.targetDate) {
    const total = Math.max(1, daysBetween(goal.startDate, goal.targetDate));
    const elapsed = Math.min(total, Math.max(0, daysBetween(goal.startDate, today)));
    expected = start + (span * elapsed) / total;
    daysLeft = daysBetween(today, goal.targetDate);
    // Today still counts as a day to work in.
    if (goal.kind !== "manual" && daysLeft >= 0) perDay = Math.max(0, target - current) / (daysLeft + 1);
    const expectedFraction = elapsed / total;
    pace = daysLeft < 0 ? "overdue" : fraction >= expectedFraction + 0.05 ? "ahead" : fraction < expectedFraction - 0.05 ? "behind" : "on_track";
  }
  if (fraction >= 1 || goal.status === "done") pace = "done";
  return { start, current, target, fraction: goal.status === "done" ? 1 : fraction, series, pace, expected, daysLeft, perDay };
}

export const PACE_LABEL: Record<Pace, string> = {
  done: "Done",
  ahead: "Ahead",
  on_track: "On track",
  behind: "Behind",
  overdue: "Past its date",
  none: "",
};

/** A goal that just reached its target and should be marked done. */
export function justReached(goal: GoalShape, p: Progress) {
  return goal.status === "active" && p.fraction >= 1 && (goal.kind !== "tasks" || p.target > 0);
}
