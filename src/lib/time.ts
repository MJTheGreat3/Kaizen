import { useEffect, useState } from "react";

export type DayPeriod = "morning" | "day" | "evening" | "night";

export function dayPeriod(date: Date): DayPeriod {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

export function greeting(date: Date): string {
  const h = date.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 22) return "Good evening";
  return "Up late";
}

/** Current time, refreshed every `intervalMs`. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export const formatClock = (d: Date) =>
  new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);

export const formatWeekday = (d: Date) => new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(d);

export const formatDayMonth = (d: Date) =>
  new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" }).format(d);
