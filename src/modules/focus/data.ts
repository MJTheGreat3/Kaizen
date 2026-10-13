import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { desc, eq, isNull } from "drizzle-orm";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import type { FocusSession, FocusStatus, FocusUnlock } from "@/core/db/schema";
import { currentDeviceId } from "@/core/security/session";
import { todayKey } from "@/lib/dates";
import { elapsedMs, isActive } from "./logic";

const f = schema.focusSessions;
const u = schema.focusUnlocks;

export interface FocusData {
  sessions: FocusSession[];
  unlocks: FocusUnlock[];
  /** The running or paused session started on this device, if any. */
  active: FocusSession | null;
  /** Tags used before, most recent first. */
  tags: string[];
}

export async function loadFocus(): Promise<FocusData> {
  const [sessions, unlocks] = await Promise.all([
    db.select().from(f).where(isNull(f.deletedAt)).orderBy(desc(f.startedAt)),
    db.select().from(u).where(isNull(u.deletedAt)),
  ]);
  const me = currentDeviceId();
  const active = sessions.find((s) => isActive(s) && s.deviceId === me) ?? null;
  const tags = [...new Set(sessions.map((s) => s.tag).filter((t): t is string => !!t))];
  return { sessions, unlocks, active, tags };
}

export function useFocus() {
  return useQuery({ queryKey: ["focus"], queryFn: loadFocus });
}

export function useFocusMutation<A, R = unknown>(fn: (a: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["focus"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export interface StartInput {
  minutes: number;
  tag: string | null;
  taskId: string | null;
  species: string;
  strict: boolean;
}

export async function startSession(input: StartInput, now = Date.now()): Promise<FocusSession> {
  const [row] = await db
    .insert(f)
    .values({
      date: todayKey(new Date(now)),
      startedAt: now,
      plannedMinutes: input.minutes,
      tag: input.tag,
      taskId: input.taskId,
      species: input.species,
      strict: input.strict,
    })
    .returning();
  return row;
}

export async function pauseSession(s: FocusSession, at = Date.now()) {
  if (s.status !== "running") return;
  await db.update(f).set({ status: "paused", pausedAt: at }).where(eq(f.id, s.id));
}

export async function resumeSession(s: FocusSession, at = Date.now()) {
  if (s.status !== "paused" || !s.pausedAt) return;
  await db
    .update(f)
    .set({ status: "running", pausedAt: null, pausedMs: s.pausedMs + Math.max(0, at - s.pausedAt) })
    .where(eq(f.id, s.id));
}

/**
 * Ends a session. A completed one counts its full planned time, earns coins
 * and shows on the activity heatmap; a withered or abandoned one keeps the
 * time actually focused, for the record.
 */
export async function finishSession(s: FocusSession, status: Exclude<FocusStatus, "running" | "paused">, at = Date.now()) {
  // Time stops at `at`, or at the pause if it was paused.
  const end = s.status === "paused" && s.pausedAt ? Math.min(at, s.pausedAt) : at;
  const focused = elapsedMs({ ...s, status: "completed", endedAt: end }, end);
  const minutes = status === "completed" ? s.plannedMinutes : Math.min(s.plannedMinutes, focused / 60_000);
  await db
    .update(f)
    .set({ status, endedAt: end, pausedAt: null, focusedMinutes: Math.round(minutes * 10) / 10 })
    .where(eq(f.id, s.id));
  if (status === "completed") await recordActivity("focus", s.date, "focus_sessions", s.id, s.plannedMinutes);
  else await clearActivity("focus_sessions", s.id);
}

export async function unlockSpecies(key: string) {
  await db
    .insert(u)
    .values({ id: key })
    .onConflictDoUpdate({ target: u.id, set: { deletedAt: null, updatedAt: Date.now() } });
}
