import { addMonths, endOfMonth, startOfMonth } from "date-fns";

import { addDaysKey, daysBetween, fromKey, isoWeekday, toKey, type DateKey } from "@/lib/dates";

export type PeriodKind = "week" | "month";

/** A calendar week (Monday to Sunday) or month; `end` is included. */
export interface Period {
  kind: PeriodKind;
  start: DateKey;
  end: DateKey;
}

export function periodOf(kind: PeriodKind, day: DateKey): Period {
  if (kind === "week") {
    const start = addDaysKey(day, 1 - isoWeekday(day));
    return { kind, start, end: addDaysKey(start, 6) };
  }
  const d = fromKey(day);
  return { kind, start: toKey(startOfMonth(d)), end: toKey(endOfMonth(d)) };
}

/** The period `n` steps before (negative) or after (positive). */
export function shift(p: Period, n: number): Period {
  if (p.kind === "week") return periodOf("week", addDaysKey(p.start, 7 * n));
  return periodOf("month", toKey(addMonths(fromKey(p.start), n)));
}

export function days(p: Period): DateKey[] {
  return Array.from({ length: daysBetween(p.start, p.end) + 1 }, (_, i) => addDaysKey(p.start, i));
}

export const within = (p: Period, day: DateKey) => day >= p.start && day <= p.end;

/** "12 – 18 Oct", "28 Sep – 4 Oct 2026" across years, "October 2026". */
export function periodLabel(p: Period, thisYear = new Date().getFullYear()): string {
  const s = fromKey(p.start);
  const e = fromKey(p.end);
  if (p.kind === "month") return s.toLocaleDateString([], { month: "long", year: "numeric" });
  const year = e.getFullYear() !== thisYear ? ` ${e.getFullYear()}` : "";
  const sameMonth = s.getMonth() === e.getMonth();
  const left = sameMonth ? String(s.getDate()) : s.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${left} – ${e.toLocaleDateString([], { day: "numeric", month: "short" })}${year}`;
}

/** Change against the previous period: "+3", "−20%", or null when there is nothing to compare. */
export function delta(now: number, before: number, percent = false): { text: string; up: boolean } | null {
  if (now === before) return null;
  if (percent) {
    if (!before) return null;
    const pct = Math.round(((now - before) / before) * 100);
    if (!pct) return null;
    return { text: `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`, up: pct > 0 };
  }
  const d = Math.round((now - before) * 10) / 10;
  return { text: `${d > 0 ? "+" : "−"}${Math.abs(d)}`, up: d > 0 };
}

export interface EventLike {
  typeId: string;
  date: DateKey;
  quantity: number;
}

export interface ActivitySummary {
  /** Days with any activity. */
  activeDays: number;
  /** Events per type. */
  counts: Map<string, number>;
  /** Events per day and type, for the daily chart. */
  perDay: Map<DateKey, Map<string, number>>;
  /** The day with the most events, if any. */
  bestDay: { day: DateKey; count: number } | null;
}

export function summarize(events: EventLike[], p: Period): ActivitySummary {
  const counts = new Map<string, number>();
  const perDay = new Map<DateKey, Map<string, number>>();
  for (const e of events) {
    if (!within(p, e.date)) continue;
    counts.set(e.typeId, (counts.get(e.typeId) ?? 0) + 1);
    const day = perDay.get(e.date) ?? new Map<string, number>();
    day.set(e.typeId, (day.get(e.typeId) ?? 0) + 1);
    perDay.set(e.date, day);
  }
  let bestDay: ActivitySummary["bestDay"] = null;
  for (const [day, types] of perDay) {
    const count = [...types.values()].reduce((a, b) => a + b, 0);
    if (!bestDay || count > bestDay.count) bestDay = { day, count };
  }
  return { activeDays: perDay.size, counts, perDay, bestDay };
}

export interface HabitLikeForRate {
  kind: "check" | "count";
  target: number;
  startDate: DateKey;
  schedule: { type: "daily" } | { type: "weekdays"; days: number[] } | { type: "weekly"; times: number };
}

/**
 * Share of planned habit check-ins done in the period, up to `today`:
 * daily and weekday habits count each planned day, weekly ones their
 * times per week (a part week counts its share).
 */
export function habitRate(
  habits: HabitLikeForRate[],
  done: (h: number, day: DateKey) => boolean,
  p: Period,
  today: DateKey,
): number | null {
  let planned = 0;
  let hit = 0;
  const span = days(p).filter((d) => d <= today);
  habits.forEach((h, i) => {
    const live = span.filter((d) => d >= h.startDate);
    if (!live.length) return;
    if (h.schedule.type === "weekly") {
      const want = Math.max(1, Math.round((h.schedule.times * live.length) / 7));
      planned += want;
      hit += Math.min(want, live.filter((d) => done(i, d)).length);
      return;
    }
    const days = h.schedule.type === "weekdays" ? h.schedule.days : null;
    for (const d of live) {
      if (days && !days.includes(isoWeekday(d))) continue;
      planned++;
      if (done(i, d)) hit++;
    }
  });
  return planned ? hit / planned : null;
}

/** "3 h 20 min", "45 min". */
export function hoursMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}
