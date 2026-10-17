/**
 * Reading sessions for books on the read list. A running session is kept on
 * this device (it survives closing Kaizen); finishing it writes a synced
 * `reading_sessions` row, moves the book's page on and adds a `reading`
 * activity event in minutes.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, desc, eq, isNull } from "drizzle-orm";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import { usePref, type Prefs } from "@/core/db/prefs";
import type { ReadingSession, Task } from "@/core/db/schema";
import { todayKey } from "@/lib/dates";

export type Running = NonNullable<Prefs["reading.running"]>;

const r = schema.readingSessions;
const t = schema.tasks;

/** Time read so far, leaving out pauses. */
export function elapsedMs(run: Running, now: number): number {
  return Math.max(0, (run.pausedAt ?? now) - run.startedAt - run.pausedMs);
}

/** `1:05:09` or `5:09`. */
export function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Pages a session covered, from the page the book was on to where it stopped. */
export function pagesCovered(from: number | undefined, to: number | null): number {
  return to === null ? 0 : Math.max(0, to - (from ?? 0));
}

export interface BookTotals {
  sessions: number;
  minutes: number;
  pages: number;
}

export function totalsOf(sessions: Pick<ReadingSession, "minutes" | "pages">[]): BookTotals {
  return {
    sessions: sessions.length,
    minutes: sessions.reduce((s, x) => s + x.minutes, 0),
    pages: sessions.reduce((s, x) => s + x.pages, 0),
  };
}

/** The session running on this device, with start, pause, resume and stop. */
export function useRunning() {
  const [running, save] = usePref("reading.running");
  return {
    running,
    start: (taskId: string) => save({ taskId, startedAt: Date.now(), pausedAt: null, pausedMs: 0 }),
    pause: () => (running && !running.pausedAt ? save({ ...running, pausedAt: Date.now() }) : undefined),
    resume: () =>
      running?.pausedAt ? save({ ...running, pausedAt: null, pausedMs: running.pausedMs + Date.now() - running.pausedAt }) : undefined,
    stop: () => save(null),
  };
}

export async function loadSessions(): Promise<ReadingSession[]> {
  return db.select().from(r).where(isNull(r.deletedAt)).orderBy(desc(r.startedAt));
}

export function useReadingSessions() {
  return useQuery({ queryKey: ["reading"], queryFn: loadSessions });
}

/** Sessions grouped by book. */
export function byBook(sessions: ReadingSession[] | undefined): Map<string, ReadingSession[]> {
  const out = new Map<string, ReadingSession[]>();
  for (const s of sessions ?? []) out.set(s.taskId, [...(out.get(s.taskId) ?? []), s]);
  return out;
}

export interface SessionInput {
  task: Task;
  startedAt: number;
  minutes: number;
  /** The page the session stopped on, if given. */
  pageEnd: number | null;
}

/** Saves a session and moves the book on; returns whether the book reached its last page. */
export async function logSession({ task, startedAt, minutes, pageEnd }: SessionInput): Promise<boolean> {
  const date = todayKey(new Date(startedAt));
  const pages = pagesCovered(task.meta.pagesRead, pageEnd);
  const [row] = await db
    .insert(r)
    .values({ taskId: task.id, date, startedAt, minutes, pages, pageEnd })
    .returning({ id: r.id });
  const [current] = await db.select({ meta: t.meta, status: t.status }).from(t).where(eq(t.id, task.id));
  const meta = current?.meta ?? task.meta;
  await db
    .update(t)
    .set({
      meta: pageEnd !== null ? { ...meta, pagesRead: Math.max(pageEnd, meta.pagesRead ?? 0) } : meta,
      status: current?.status === "open" ? "in_progress" : current?.status,
    })
    .where(eq(t.id, task.id));
  if (minutes > 0) await recordActivity("reading", date, "reading_sessions", row.id, minutes);
  return pageEnd !== null && !!meta.pagesTotal && pageEnd >= meta.pagesTotal;
}

export async function removeSession(id: string) {
  await db.update(r).set({ deletedAt: Date.now() }).where(and(eq(r.id, id), isNull(r.deletedAt)));
  await clearActivity("reading_sessions", id);
}

function useReadingMutation<A, R>(fn: (a: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["reading"] });
      client.invalidateQueries({ queryKey: ["tasks"] });
      client.invalidateQueries({ queryKey: ["today"] });
      client.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export const useLogSession = () => useReadingMutation(logSession);
export const useRemoveSession = () => useReadingMutation(removeSession);
