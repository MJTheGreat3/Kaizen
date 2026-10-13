import { addDays, differenceInCalendarDays, format, isValid, parse } from "date-fns";

/** Local calendar date as `YYYY-MM-DD`. */
export type DateKey = string;

export function toKey(date: Date): DateKey {
  return format(date, "yyyy-MM-dd");
}

export function fromKey(key: DateKey): Date {
  const d = parse(key, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : new Date(NaN);
}

export function todayKey(now = new Date()): DateKey {
  return toKey(now);
}

export function addDaysKey(key: DateKey, days: number): DateKey {
  return toKey(addDays(fromKey(key), days));
}

export function daysBetween(from: DateKey, to: DateKey): number {
  return differenceInCalendarDays(fromKey(to), fromKey(from));
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export function isoWeekday(key: DateKey): number {
  const d = fromKey(key).getDay();
  return d === 0 ? 7 : d;
}

/** `HH:MM` to minutes after midnight. */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Minutes after midnight as a readable time, e.g. `9:30 am`. */
export function formatMinutes(min: number): string {
  const d = new Date(2000, 0, 1, Math.floor(min / 60), min % 60);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
}

export function atTime(key: DateKey, minutes: number): Date {
  const d = fromKey(key);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Short, friendly label for a due date relative to today. */
export function relativeDay(key: DateKey, today: DateKey = todayKey()): string {
  const diff = daysBetween(today, key);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = fromKey(key);
  if (diff > 1 && diff < 7) return format(d, "EEEE");
  if (d.getFullYear() === fromKey(today).getFullYear()) return format(d, "d MMM");
  return format(d, "d MMM yyyy");
}

export function formatLongDate(key: DateKey): string {
  return format(fromKey(key), "EEEE, d MMMM");
}
