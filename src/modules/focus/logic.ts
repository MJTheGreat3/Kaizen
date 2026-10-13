/**
 * Pure focus-timer logic: time maths, coins and stats. Sessions keep wall
 * clock timestamps (not ticking counters), so a timer survives reloads,
 * locks and the app being closed.
 */
import type { FocusSession, FocusUnlock } from "@/core/db/schema";
import { addDaysKey, todayKey, type DateKey } from "@/lib/dates";

export type TreeShape = "round" | "cone" | "blossom" | "maple" | "birch" | "cactus";

export interface Species {
  key: string;
  name: string;
  /** Focus coins to unlock; 0 means available from the start. */
  cost: number;
  shape: TreeShape;
  leaf: string;
  leafDeep: string;
  trunk: string;
}

export const SPECIES: Species[] = [
  { key: "oak", name: "Oak", cost: 0, shape: "round", leaf: "#4caf6a", leafDeep: "#2f7f4b", trunk: "#7a5236" },
  { key: "pine", name: "Pine", cost: 0, shape: "cone", leaf: "#2f8f6b", leafDeep: "#1d6650", trunk: "#6b4a33" },
  { key: "cherry", name: "Cherry blossom", cost: 300, shape: "blossom", leaf: "#f4a6c0", leafDeep: "#e07a9f", trunk: "#5e3d33" },
  { key: "maple", name: "Maple", cost: 600, shape: "maple", leaf: "#ee7a3c", leafDeep: "#c9522a", trunk: "#6e4630" },
  { key: "birch", name: "Birch", cost: 900, shape: "birch", leaf: "#b7d35a", leafDeep: "#8bab37", trunk: "#ece6dc" },
  { key: "cactus", name: "Cactus", cost: 1200, shape: "cactus", leaf: "#5fa86f", leafDeep: "#3f8452", trunk: "#d98a5f" },
];

export function speciesFor(key: string): Species {
  return SPECIES.find((s) => s.key === key) ?? SPECIES[0];
}

export const PRESETS = [
  { focus: 25, rest: 5, label: "Pomodoro" },
  { focus: 50, rest: 10, label: "Deep work" },
  { focus: 90, rest: 15, label: "Long haul" },
] as const;

const MINUTE = 60_000;

export function isActive(s: Pick<FocusSession, "status">) {
  return s.status === "running" || s.status === "paused";
}

/** Focused time so far, excluding pauses. */
export function elapsedMs(s: Pick<FocusSession, "startedAt" | "pausedMs" | "pausedAt" | "status" | "endedAt">, now: number) {
  const end = isActive(s as FocusSession) ? now : (s.endedAt ?? now);
  const pausedNow = s.status === "paused" && s.pausedAt ? end - s.pausedAt : 0;
  return Math.max(0, end - s.startedAt - s.pausedMs - pausedNow);
}

export function remainingMs(s: FocusSession, now: number) {
  return Math.max(0, s.plannedMinutes * MINUTE - elapsedMs(s, now));
}

/** 0..1 growth of the tree. */
export function progress(s: FocusSession, now: number) {
  return Math.min(1, elapsedMs(s, now) / (s.plannedMinutes * MINUTE));
}

/** When a running session will finish, as a timestamp. */
export function endsAt(s: FocusSession, now: number) {
  return now + remainingMs(s, now);
}

export function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

export function formatMinutes(minutes: number) {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Coins: one per completed focus minute, minus species bought. */
export function coins(sessions: FocusSession[], unlocks: FocusUnlock[]) {
  const earned = sessions
    .filter((s) => s.status === "completed" && !s.deletedAt)
    .reduce((sum, s) => sum + Math.floor(s.focusedMinutes), 0);
  const spent = unlocks.filter((u) => !u.deletedAt).reduce((sum, u) => sum + speciesFor(u.id).cost, 0);
  return { earned, spent, balance: earned - spent };
}

export function isUnlocked(species: Species, unlocks: FocusUnlock[]) {
  return species.cost === 0 || unlocks.some((u) => u.id === species.key && !u.deletedAt);
}

export interface FocusStats {
  todayMinutes: number;
  weekMinutes: number;
  totalMinutes: number;
  completed: number;
  withered: number;
  longestMinutes: number;
  /** Minutes per day for the last 14 days, oldest first. */
  days: { date: DateKey; minutes: number }[];
  /** Completed minutes per tag (untagged under ""), largest first. */
  tags: { tag: string; minutes: number }[];
  /** Completed minutes by the hour sessions started (0..23). */
  hours: number[];
  bestHour: number | null;
}

export function stats(sessions: FocusSession[], now = new Date()): FocusStats {
  const today = todayKey(now);
  const weekStart = addDaysKey(today, -6);
  const done = sessions.filter((s) => s.status === "completed" && !s.deletedAt);
  const sum = (list: FocusSession[]) => list.reduce((a, s) => a + s.focusedMinutes, 0);
  const byDay = new Map<DateKey, number>();
  const byTag = new Map<string, number>();
  const hours = Array.from({ length: 24 }, () => 0);
  for (const s of done) {
    byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.focusedMinutes);
    byTag.set(s.tag ?? "", (byTag.get(s.tag ?? "") ?? 0) + s.focusedMinutes);
    hours[new Date(s.startedAt).getHours()] += s.focusedMinutes;
  }
  const best = Math.max(...hours);
  return {
    todayMinutes: byDay.get(today) ?? 0,
    weekMinutes: sum(done.filter((s) => s.date >= weekStart && s.date <= today)),
    totalMinutes: sum(done),
    completed: done.length,
    withered: sessions.filter((s) => s.status === "withered" && !s.deletedAt).length,
    longestMinutes: done.reduce((a, s) => Math.max(a, s.focusedMinutes), 0),
    days: Array.from({ length: 14 }, (_, i) => {
      const date = addDaysKey(today, i - 13);
      return { date, minutes: byDay.get(date) ?? 0 };
    }),
    tags: [...byTag].map(([tag, minutes]) => ({ tag, minutes })).sort((a, b) => b.minutes - a.minutes),
    hours,
    bestHour: best > 0 ? hours.indexOf(best) : null,
  };
}
