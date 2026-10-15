import { useQuery } from "@tanstack/react-query";
import { and, between, eq, gte, isNull, lte } from "drizzle-orm";

import { db, schema } from "@/core/db/client";
import type { ActivityType, Habit, MusicPlay } from "@/core/db/schema";
import { todayKey, type DateKey } from "@/lib/dates";
import { isDone } from "@/modules/habits/streaks";
import { habitRate, shift, summarize, type ActivitySummary, type Period } from "./logic";

const startMs = (d: DateKey) => new Date(`${d}T00:00:00`).getTime();
const endMs = (d: DateKey) => new Date(`${d}T23:59:59.999`).getTime();

export interface PeriodStats {
  activity: ActivitySummary;
  tasksDone: number;
  booksFinished: string[];
  /** Share of planned habit check-ins done, or null with no habits. */
  habits: number | null;
  focusMinutes: number;
  focusSessions: number;
  longestFocus: number;
  workouts: number;
  /** kg */
  volume: number;
  problems: number;
  sportsMinutes: number;
  musicMinutes: number;
  topSong: { title: string; artist: string; plays: number } | null;
  topArtist: { name: string; plays: number } | null;
  ideas: number;
  boards: number;
}

export interface Review {
  current: PeriodStats;
  previous: PeriodStats;
  types: ActivityType[];
}

function topOf<T>(items: T[], key: (t: T) => string): [string, number, T] | null {
  const counts = new Map<string, [number, T]>();
  for (const t of items) {
    const k = key(t);
    const c = counts.get(k);
    counts.set(k, [(c?.[0] ?? 0) + 1, c?.[1] ?? t]);
  }
  let best: [string, number, T] | null = null;
  for (const [k, [n, t]] of counts) if (!best || n > best[1]) best = [k, n, t];
  return best;
}

async function statsFor(
  p: Period,
  habits: Habit[],
  logs: { habitId: string; date: DateKey; value: number }[],
  events: { typeId: string; date: DateKey; quantity: number }[],
): Promise<PeriodStats> {
  const from = startMs(p.start);
  const to = endMs(p.end);
  const t = schema.tasks;
  const f = schema.focusSessions;
  const w = schema.workouts;
  const mp = schema.musicPlays;
  const [done, focus, workouts, plays, ideas, boards] = await Promise.all([
    db
      .select({ list: t.list, title: t.title })
      .from(t)
      .where(and(isNull(t.deletedAt), eq(t.status, "done"), between(t.completedAt, from, to))),
    db
      .select({ minutes: f.focusedMinutes, status: f.status })
      .from(f)
      .where(and(isNull(f.deletedAt), gte(f.date, p.start), lte(f.date, p.end))),
    db
      .select({ volume: w.volume })
      .from(w)
      .where(and(isNull(w.deletedAt), gte(w.date, p.start), lte(w.date, p.end), gte(w.endedAt, 0))),
    db
      .select()
      .from(mp)
      .where(and(isNull(mp.deletedAt), between(mp.playedAt, from, to))),
    db
      .select({ id: schema.ideas.id })
      .from(schema.ideas)
      .where(and(isNull(schema.ideas.deletedAt), between(schema.ideas.createdAt, from, to))),
    db
      .select({ id: schema.boards.id })
      .from(schema.boards)
      .where(and(isNull(schema.boards.deletedAt), between(schema.boards.createdAt, from, to))),
  ]);

  const logged = new Map(logs.map((l) => [`${l.habitId}:${l.date}`, l.value]));
  const rate = habitRate(habits, (i, day) => isDone(habits[i], logged.get(`${habits[i].id}:${day}`)), p, todayKey());
  const inPeriod = events.filter((e) => e.date >= p.start && e.date <= p.end);
  const song = topOf<MusicPlay>(plays, (x) => x.trackId);
  const artist = topOf(
    plays.flatMap((x) => x.artists.slice(0, 1)),
    (a) => a,
  );
  const completed = focus.filter((s) => s.status === "completed");
  return {
    activity: summarize(events, p),
    tasksDone: done.filter((d) => d.list === "todo").length,
    booksFinished: done.filter((d) => d.list === "read").map((d) => d.title),
    habits: rate,
    focusMinutes: focus.reduce((s, x) => s + (x.minutes ?? 0), 0),
    focusSessions: completed.length,
    longestFocus: Math.max(0, ...focus.map((x) => x.minutes ?? 0)),
    workouts: workouts.length,
    volume: workouts.reduce((s, x) => s + (x.volume ?? 0), 0),
    problems: inPeriod.filter((e) => e.typeId === "cp").length,
    sportsMinutes: inPeriod.filter((e) => e.typeId === "sports").reduce((s, e) => s + e.quantity, 0),
    musicMinutes: plays.reduce((s, x) => s + x.durationMs / 60_000, 0),
    topSong: song && song[1] > 1 ? { title: song[2].title, artist: song[2].artists[0] ?? "", plays: song[1] } : null,
    topArtist: artist && artist[1] > 1 ? { name: artist[0], plays: artist[1] } : null,
    ideas: ideas.length,
    boards: boards.length,
  };
}

async function loadReview(p: Period): Promise<Review> {
  const prev = shift(p, -1);
  const e = schema.activityEvents;
  const [events, types, habits, logs] = await Promise.all([
    db
      .select({ typeId: e.typeId, date: e.date, quantity: e.quantity })
      .from(e)
      .where(and(isNull(e.deletedAt), gte(e.date, prev.start), lte(e.date, p.end))),
    db.select().from(schema.activityTypes).where(isNull(schema.activityTypes.deletedAt)),
    db
      .select()
      .from(schema.habits)
      .where(and(isNull(schema.habits.deletedAt), eq(schema.habits.archived, false))),
    db
      .select({ habitId: schema.habitLogs.habitId, date: schema.habitLogs.date, value: schema.habitLogs.value })
      .from(schema.habitLogs)
      .where(
        and(
          isNull(schema.habitLogs.deletedAt),
          gte(schema.habitLogs.date, prev.start),
          lte(schema.habitLogs.date, p.end),
        ),
      ),
  ]);
  const [current, previous] = await Promise.all([
    statsFor(p, habits, logs, events),
    statsFor(prev, habits, logs, events),
  ]);
  return { current, previous, types: types.sort((a, b) => a.sortOrder - b.sortOrder) };
}

export function useReview(p: Period) {
  return useQuery({ queryKey: ["review", p.kind, p.start], queryFn: () => loadReview(p) });
}
