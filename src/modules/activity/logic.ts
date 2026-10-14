/**
 * Pure heatmap and streak maths over `activity_events`. Every module writes
 * events (type, date, quantity); everything here reads only those, so a new
 * module shows up on the heatmap without changes.
 */
import { addDaysKey, daysBetween, isoWeekday, todayKey, type DateKey } from "@/lib/dates";

export interface ActiveRule {
  /** Count streaks in days, or in weeks with enough active days. */
  period: "day" | "week";
  /** Quantity needed on a day for it to count as active. */
  min: number;
  /** For weekly streaks: active days needed per week. */
  perWeek: number;
  /** ISO weekdays (1 = Monday) that never break a daily streak. */
  restDays: number[];
  /** Missed days per calendar month that are forgiven. */
  freezesPerMonth: number;
}

const DEFAULT_RULE: ActiveRule = { period: "day", min: 1, perWeek: 3, restDays: [], freezesPerMonth: 0 };

/** Sensible defaults per built-in type, used until the user changes the rule. */
const TYPE_DEFAULTS: Record<string, Partial<ActiveRule>> = {
  focus: { min: 25 },
  gym: { period: "week", perWeek: 3 },
  sports: { min: 20 },
};

export function ruleFor(typeId: string, stored: string | null | undefined): ActiveRule {
  let parsed: Partial<ActiveRule>;
  try {
    parsed = stored ? (JSON.parse(stored) as Partial<ActiveRule>) : {};
  } catch {
    parsed = {};
  }
  return { ...DEFAULT_RULE, ...TYPE_DEFAULTS[typeId], ...parsed };
}

const SINGULAR: Record<string, string> = { classes: "class", minutes: "minute" };

export function ruleLabel(rule: ActiveRule, unit: string | null) {
  const name = unit && rule.min === 1 ? (SINGULAR[unit] ?? unit.replace(/s$/, "")) : (unit ?? "");
  const amount = `${rule.min} ${name}`.trim();
  if (rule.period === "week") return `${rule.perWeek} active days a week (≥ ${amount} each)`;
  return `≥ ${amount} a day`;
}

export interface EventLike {
  typeId: string;
  date: DateKey;
  quantity: number;
}

/** type -> date -> total quantity. */
export type DayTotals = Map<string, Map<DateKey, number>>;

export function totalsByDay(events: EventLike[]): DayTotals {
  const out: DayTotals = new Map();
  for (const e of events) {
    let days = out.get(e.typeId);
    if (!days) out.set(e.typeId, (days = new Map()));
    days.set(e.date, (days.get(e.date) ?? 0) + e.quantity);
  }
  return out;
}

export function activeDays(days: Map<DateKey, number> | undefined, rule: ActiveRule): Set<DateKey> {
  const out = new Set<DateKey>();
  for (const [date, q] of days ?? []) if (q >= rule.min) out.add(date);
  return out;
}

/**
 * Intensity 1..4 for each day with activity, by quartile of that type's own
 * values, so one heavy type does not wash out the others.
 */
export function levels(days: Map<DateKey, number> | undefined, from: DateKey, to: DateKey): Map<DateKey, number> {
  const inRange = [...(days ?? [])].filter(([d, q]) => d >= from && d <= to && q > 0);
  const sorted = inRange.map(([, q]) => q).sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.floor(p * (sorted.length - 1))];
  const [q1, q2, q3] = [at(0.25), at(0.5), at(0.75)];
  const out = new Map<DateKey, number>();
  for (const [d, q] of inRange) {
    out.set(d, sorted.length < 4 || sorted[0] === sorted[sorted.length - 1] ? 3 : q <= q1 ? 1 : q <= q2 ? 2 : q <= q3 ? 3 : 4);
  }
  return out;
}

export interface Streak {
  current: number;
  longest: number;
  /** First day (or week start) of the current streak. */
  since: DateKey | null;
  unit: "days" | "weeks";
  /** Active today (or this week, for weekly rules). */
  doneNow: boolean;
}

const monthOf = (d: DateKey) => d.slice(0, 7);

/** Monday of the ISO week containing `d`. */
export function weekStart(d: DateKey): DateKey {
  return addDaysKey(d, 1 - isoWeekday(d));
}

function dailyStreak(active: Set<DateKey>, rule: ActiveRule, today: DateKey): Streak {
  const first = [...active].sort()[0];
  if (!first) return { current: 0, longest: 0, since: null, unit: "days", doneNow: false };

  // Walk forward from the first active day, bridging rest days and frozen days.
  let longest = 0;
  let run = 0;
  let runStart: DateKey | null = null;
  const freezesUsed = new Map<string, number>();
  for (let d = first; d <= today; d = addDaysKey(d, 1)) {
    const isToday = d === today;
    if (active.has(d)) {
      if (!run) runStart = d;
      run++;
    } else if (rule.restDays.includes(isoWeekday(d))) {
      // A rest day keeps the run going without adding to it.
    } else if (isToday) {
      // Today is not over yet.
    } else if (run && (freezesUsed.get(monthOf(d)) ?? 0) < rule.freezesPerMonth) {
      freezesUsed.set(monthOf(d), (freezesUsed.get(monthOf(d)) ?? 0) + 1);
    } else {
      run = 0;
      runStart = null;
    }
    longest = Math.max(longest, run);
  }
  return { current: run, longest, since: run ? runStart : null, unit: "days", doneNow: active.has(today) };
}

function weeklyStreak(active: Set<DateKey>, rule: ActiveRule, today: DateKey): Streak {
  const counts = new Map<DateKey, number>();
  for (const d of active) counts.set(weekStart(d), (counts.get(weekStart(d)) ?? 0) + 1);
  const firstWeek = [...counts.keys()].sort()[0];
  const thisWeek = weekStart(today);
  if (!firstWeek) return { current: 0, longest: 0, since: null, unit: "weeks", doneNow: false };
  let longest = 0;
  let run = 0;
  let runStart: DateKey | null = null;
  for (let w = firstWeek; w <= thisWeek; w = addDaysKey(w, 7)) {
    const ok = (counts.get(w) ?? 0) >= rule.perWeek;
    if (ok) {
      if (!run) runStart = w;
      run++;
    } else if (w !== thisWeek) {
      run = 0;
      runStart = null;
    }
    longest = Math.max(longest, run);
  }
  return {
    current: run,
    longest,
    since: run ? runStart : null,
    unit: "weeks",
    doneNow: (counts.get(thisWeek) ?? 0) >= rule.perWeek,
  };
}

export function streak(active: Set<DateKey>, rule: ActiveRule, today = todayKey()): Streak {
  return rule.period === "week" ? weeklyStreak(active, rule, today) : dailyStreak(active, rule, today);
}

/** Share of days in `from..to` (up to today) that were active. */
export function activeRate(active: Set<DateKey>, from: DateKey, to: DateKey) {
  const days = daysBetween(from, to) + 1;
  let n = 0;
  for (const d of active) if (d >= from && d <= to) n++;
  return days > 0 ? n / days : 0;
}

/** Share of weeks in `from..to` with enough active days for a weekly rule. */
export function activeWeeksRate(active: Set<DateKey>, rule: ActiveRule, from: DateKey, to: DateKey) {
  const counts = new Map<DateKey, number>();
  for (const d of active) if (d >= from && d <= to) counts.set(weekStart(d), (counts.get(weekStart(d)) ?? 0) + 1);
  let weeks = 0;
  let met = 0;
  for (let w = weekStart(from); w <= to; w = addDaysKey(w, 7)) {
    weeks++;
    if ((counts.get(w) ?? 0) >= rule.perWeek) met++;
  }
  return weeks ? met / weeks : 0;
}

export const MILESTONES = [7, 30, 100, 365];

/** The milestone just reached, if `current` sits exactly on one. */
export function milestoneAt(current: number) {
  return MILESTONES.includes(current) ? current : null;
}

/** Weeks (Monday first) covering `from..to`, as columns of 7 dates. */
export function weekColumns(from: DateKey, to: DateKey): DateKey[][] {
  const cols: DateKey[][] = [];
  for (let w = weekStart(from); w <= to; w = addDaysKey(w, 7)) {
    cols.push(Array.from({ length: 7 }, (_, i) => addDaysKey(w, i)));
  }
  return cols;
}
