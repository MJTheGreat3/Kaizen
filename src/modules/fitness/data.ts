import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import { usePref } from "@/core/db/prefs";
import type { Attachment, BodyMetric, Exercise, Measure, Muscle, TemplateItem, Workout, WorkoutSet, WorkoutTemplate } from "@/core/db/schema";
import { ipc } from "@/lib/ipc";
import { todayKey, type DateKey } from "@/lib/dates";
import { ruleFor, type ActiveRule } from "@/modules/activity/logic";
import { previousSets, volumeOf, type Unit } from "./logic";

const ex = schema.exercises;
const tpl = schema.workoutTemplates;
const wo = schema.workouts;
const ws = schema.workoutSets;
const bm = schema.bodyMetrics;
const att = schema.attachments;

export interface GymData {
  exercises: Exercise[];
  byId: Map<string, Exercise>;
  templates: WorkoutTemplate[];
  /** Newest first. */
  workouts: Workout[];
  sets: WorkoutSet[];
  active: Workout | null;
  /** Oldest first. */
  metrics: BodyMetric[];
  photos: Attachment[];
  /** The heatmap's active-day rule for Gym, for the streak. */
  rule: ActiveRule;
}

export async function loadGym(): Promise<GymData> {
  const [exercises, templates, workouts, sets, metrics, photos, type] = await Promise.all([
    db.select().from(ex).where(isNull(ex.deletedAt)).orderBy(asc(ex.name)),
    db.select().from(tpl).where(isNull(tpl.deletedAt)).orderBy(asc(tpl.sort), asc(tpl.createdAt)),
    db.select().from(wo).where(isNull(wo.deletedAt)).orderBy(desc(wo.startedAt)),
    db.select().from(ws).where(isNull(ws.deletedAt)).orderBy(asc(ws.position), asc(ws.setIndex)),
    db.select().from(bm).where(isNull(bm.deletedAt)).orderBy(asc(bm.date)),
    db
      .select()
      .from(att)
      .where(and(eq(att.ownerTable, "body_metrics"), isNull(att.deletedAt)))
      .orderBy(desc(att.ownerId), desc(att.createdAt)),
    db.select().from(schema.activityTypes).where(eq(schema.activityTypes.id, "gym")).get(),
  ]);
  return {
    exercises,
    byId: new Map(exercises.map((e) => [e.id, e])),
    templates,
    workouts,
    sets,
    active: workouts.find((w) => !w.endedAt) ?? null,
    metrics,
    photos,
    rule: ruleFor("gym", type?.activeDayRule),
  };
}

export function useGym() {
  return useQuery({ queryKey: ["gym"], queryFn: loadGym });
}

export function useUnit(): Unit {
  return usePref("gym.unit")[0];
}

const AFFECTED = [["gym"], ["activity"], ["goals"], ["today"], ["search-index"]];

function useGymMutation<A, R = unknown>(fn: (a: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of AFFECTED) void client.invalidateQueries({ queryKey: key });
    },
  });
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

/** New sets for an exercise, prefilled from the last time it was done. */
function setsFor(workoutId: string, exerciseId: string, position: number, count: number, reps: number | null, history: { sets: WorkoutSet[]; workouts: Workout[] }, measure: Measure) {
  const prev = previousSets(exerciseId, history.sets, history.workouts, Date.now(), workoutId).filter((s) => !s.warmup);
  return Array.from({ length: Math.max(1, count) }, (_, i) => {
    const p = prev[Math.min(i, prev.length - 1)];
    return {
      id: uuidv7(),
      workoutId,
      exerciseId,
      position,
      setIndex: i,
      weight: p?.weight ?? null,
      reps: p?.reps ?? (measure === "time" || measure === "cardio" ? null : reps),
      seconds: p?.seconds ?? (measure === "time" ? reps : null),
      distance: p?.distance ?? null,
    };
  });
}

async function history() {
  const [sets, workouts] = await Promise.all([db.select().from(ws).where(isNull(ws.deletedAt)), db.select().from(wo).where(isNull(wo.deletedAt))]);
  return { sets, workouts };
}

async function measureOf(exerciseId: string): Promise<Measure> {
  return (await db.select({ m: ex.measure }).from(ex).where(eq(ex.id, exerciseId)).get())?.m ?? "weight";
}

/** Starts a workout (empty, or from a routine), or returns the one in progress. */
export function useStartWorkout() {
  return useGymMutation(async (template: WorkoutTemplate | null): Promise<string> => {
    const running = await db
      .select()
      .from(wo)
      .where(and(isNull(wo.endedAt), isNull(wo.deletedAt)))
      .get();
    if (running) return running.id;
    const id = uuidv7();
    await db.insert(wo).values({ id, name: template?.name ?? "Workout", templateId: template?.id ?? null, date: todayKey(), startedAt: Date.now() });
    if (template?.exercises.length) {
      const h = await history();
      const rows = [];
      for (const [position, item] of template.exercises.entries()) {
        rows.push(...setsFor(id, item.exerciseId, position, item.sets, item.reps, h, await measureOf(item.exerciseId)));
      }
      await db.insert(ws).values(rows);
    }
    return id;
  });
}

/** Keeps a workout's volume (and its search entry) current. */
async function refreshVolume(workoutId: string) {
  const sets = await db
    .select()
    .from(ws)
    .where(and(eq(ws.workoutId, workoutId), isNull(ws.deletedAt)));
  await db.update(wo).set({ volume: volumeOf(sets) }).where(eq(wo.id, workoutId));
}

export function useAddExercises() {
  return useGymMutation(async ({ workoutId, exerciseIds }: { workoutId: string; exerciseIds: string[] }) => {
    const existing = await db
      .select({ position: ws.position })
      .from(ws)
      .where(and(eq(ws.workoutId, workoutId), isNull(ws.deletedAt)));
    let position = Math.max(-1, ...existing.map((s) => s.position)) + 1;
    const h = await history();
    for (const exerciseId of exerciseIds) {
      await db.insert(ws).values(setsFor(workoutId, exerciseId, position++, 3, null, h, await measureOf(exerciseId)));
    }
  });
}

export function useUpdateSet() {
  return useGymMutation(async ({ id, workoutId, patch }: { id: string; workoutId: string; patch: Partial<Pick<WorkoutSet, "weight" | "reps" | "seconds" | "distance" | "rpe" | "warmup" | "done">> }) => {
    await db.update(ws).set(patch).where(eq(ws.id, id));
    await refreshVolume(workoutId);
  });
}

/** Adds a set after the exercise's last one, copying it. */
export function useAddSet() {
  return useGymMutation(async ({ workoutId, exerciseId, position }: { workoutId: string; exerciseId: string; position: number }) => {
    const sets = await db
      .select()
      .from(ws)
      .where(and(eq(ws.workoutId, workoutId), eq(ws.position, position), isNull(ws.deletedAt)))
      .orderBy(asc(ws.setIndex));
    const last = sets.at(-1);
    await db.insert(ws).values({
      workoutId,
      exerciseId,
      position,
      setIndex: (last?.setIndex ?? -1) + 1,
      weight: last?.weight ?? null,
      reps: last?.reps ?? null,
      seconds: last?.seconds ?? null,
      distance: last?.distance ?? null,
    });
  });
}

export function useRemoveSet() {
  return useGymMutation(async ({ id, workoutId }: { id: string; workoutId: string }) => {
    await db.update(ws).set({ deletedAt: Date.now() }).where(eq(ws.id, id));
    await refreshVolume(workoutId);
  });
}

export function useRemoveExercise() {
  return useGymMutation(async ({ workoutId, position }: { workoutId: string; position: number }) => {
    await db
      .update(ws)
      .set({ deletedAt: Date.now() })
      .where(and(eq(ws.workoutId, workoutId), eq(ws.position, position), isNull(ws.deletedAt)));
    await refreshVolume(workoutId);
  });
}

/** Swaps an exercise with its neighbour. */
export function useMoveExercise() {
  return useGymMutation(async ({ workoutId, position, by }: { workoutId: string; position: number; by: -1 | 1 }) => {
    const sets = await db
      .select()
      .from(ws)
      .where(and(eq(ws.workoutId, workoutId), isNull(ws.deletedAt)));
    const positions = [...new Set(sets.map((s) => s.position))].sort((a, b) => a - b);
    const other = positions[positions.indexOf(position) + by];
    if (other === undefined) return;
    for (const s of sets) {
      if (s.position === position) await db.update(ws).set({ position: other }).where(eq(ws.id, s.id));
      else if (s.position === other) await db.update(ws).set({ position }).where(eq(ws.id, s.id));
    }
  });
}

export function useUpdateWorkout() {
  return useGymMutation(async ({ id, patch }: { id: string; patch: Partial<Pick<Workout, "name" | "notes" | "date" | "startedAt" | "endedAt">> }) => {
    await db.update(wo).set(patch).where(eq(wo.id, id));
    const w = await db.select().from(wo).where(eq(wo.id, id)).get();
    if (w?.endedAt) await recordActivity("gym", w.date, "workouts", id, 1);
  });
}

/** Ends a workout: drops sets never ticked, totals the volume, marks the day. */
export function useFinishWorkout() {
  return useGymMutation(async (id: string) => {
    const w = await db.select().from(wo).where(eq(wo.id, id)).get();
    if (!w) return;
    await db
      .update(ws)
      .set({ deletedAt: Date.now() })
      .where(and(eq(ws.workoutId, id), eq(ws.done, false), isNull(ws.deletedAt)));
    await refreshVolume(id);
    await db.update(wo).set({ endedAt: Date.now() }).where(eq(wo.id, id));
    await recordActivity("gym", w.date, "workouts", id, 1);
  });
}

export function useDeleteWorkout() {
  return useGymMutation(async (id: string) => {
    const now = Date.now();
    await db.update(wo).set({ deletedAt: now }).where(eq(wo.id, id));
    await db
      .update(ws)
      .set({ deletedAt: now })
      .where(and(eq(ws.workoutId, id), isNull(ws.deletedAt)));
    await clearActivity("workouts", id);
  });
}

/** Logs a past workout by hand; it opens for its sets to be filled in. */
export function useLogPastWorkout() {
  return useGymMutation(async ({ name, date, minutes }: { name: string; date: DateKey; minutes: number }) => {
    const id = uuidv7();
    const startedAt = new Date(`${date}T18:00:00`).getTime();
    await db.insert(wo).values({ id, name, date, startedAt, endedAt: startedAt + minutes * 60_000 });
    await recordActivity("gym", date, "workouts", id, 1);
    return id;
  });
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export function useSaveTemplate() {
  return useGymMutation(async ({ id, name, notes, exercises }: { id?: string; name: string; notes: string | null; exercises: TemplateItem[] }) => {
    if (id) {
      await db.update(tpl).set({ name, notes, exercises }).where(eq(tpl.id, id));
      return id;
    }
    const all = await db.select({ sort: tpl.sort }).from(tpl).where(isNull(tpl.deletedAt));
    const newId = uuidv7();
    await db.insert(tpl).values({ id: newId, name, notes, exercises, sort: Math.max(-1, ...all.map((t) => t.sort)) + 1 });
    return newId;
  });
}

export function useDeleteTemplate() {
  return useGymMutation(async (id: string) => {
    await db.update(tpl).set({ deletedAt: Date.now() }).where(eq(tpl.id, id));
  });
}

/** Routines from a list of names and items (the starter Push, Pull, Legs). */
export function useAddTemplates() {
  return useGymMutation(async (list: { name: string; exercises: TemplateItem[] }[]) => {
    const all = await db.select({ sort: tpl.sort }).from(tpl).where(isNull(tpl.deletedAt));
    let sort = Math.max(-1, ...all.map((t) => t.sort)) + 1;
    for (const t of list) await db.insert(tpl).values({ name: t.name, notes: null, exercises: t.exercises, sort: sort++ });
  });
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

export interface ExerciseInput {
  id?: string;
  name: string;
  muscle: Muscle;
  equipment: string;
  measure: Measure;
  notes: string | null;
}

export function useSaveExercise() {
  return useGymMutation(async ({ id, ...input }: ExerciseInput): Promise<string> => {
    if (id) {
      await db.update(ex).set(input).where(eq(ex.id, id));
      return id;
    }
    const newId = uuidv7();
    await db.insert(ex).values({ id: newId, ...input, isBuiltin: false });
    return newId;
  });
}

export function useDeleteExercise() {
  return useGymMutation(async (id: string) => {
    await db.update(ex).set({ deletedAt: Date.now() }).where(eq(ex.id, id));
  });
}

// ---------------------------------------------------------------------------
// Body metrics and photos
// ---------------------------------------------------------------------------

export type MetricInput = Omit<BodyMetric, "id" | "createdAt" | "updatedAt" | "deletedAt" | "deviceId">;

export const metricId = (date: DateKey) => `bm:${date}`;

export function useSaveMetric() {
  return useGymMutation(async (input: MetricInput) => {
    const id = metricId(input.date);
    await db
      .insert(bm)
      .values({ id, ...input })
      .onConflictDoUpdate({ target: bm.id, set: { ...input, deletedAt: null, updatedAt: Date.now() } });
  });
}

export function useDeleteMetric() {
  return useGymMutation(async (date: DateKey) => {
    await db
      .update(bm)
      .set({ deletedAt: Date.now() })
      .where(eq(bm.id, metricId(date)));
  });
}

/** Shrinks a photo to at most 1600 px on its long side, as JPEG base64. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return url.slice(url.indexOf(",") + 1);
}

/** Adds progress photos to a day, creating the day's entry if needed. */
export function useAddPhotos() {
  return useGymMutation(async ({ date, files }: { date: DateKey; files: File[] }) => {
    const id = metricId(date);
    const row = await db.select().from(bm).where(eq(bm.id, id)).get();
    if (!row) await db.insert(bm).values({ id, date });
    else if (row.deletedAt) await db.update(bm).set({ deletedAt: null }).where(eq(bm.id, id));
    for (const file of files) {
      await ipc.attachmentAdd("body_metrics", id, file.name.replace(/\.\w+$/, ".jpg"), "image/jpeg", await shrink(file));
    }
  });
}

export function useRemovePhoto() {
  return useGymMutation((id: string) => ipc.attachmentRemove(id));
}

/** A photo as a data URL; fails when it was taken on another device. */
export function usePhoto(id: string) {
  return useQuery({
    queryKey: ["gym-photo", id],
    queryFn: async () => `data:image/jpeg;base64,${await ipc.attachmentRead(id)}`,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  });
}
