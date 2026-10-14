/**
 * Pure gym helpers: units, estimated one-rep max, volume, personal records,
 * weekly totals and the starter routines.
 */
import type { Exercise, Measure, Muscle, TemplateItem, Workout, WorkoutSet } from "@/core/db/schema";
import { addDaysKey, type DateKey } from "@/lib/dates";
import { weekStart } from "@/modules/activity/logic";

export const MUSCLES: { id: Muscle; name: string }[] = [
  { id: "chest", name: "Chest" },
  { id: "back", name: "Back" },
  { id: "shoulders", name: "Shoulders" },
  { id: "biceps", name: "Biceps" },
  { id: "triceps", name: "Triceps" },
  { id: "forearms", name: "Forearms" },
  { id: "abs", name: "Abs" },
  { id: "quads", name: "Quads" },
  { id: "hamstrings", name: "Hamstrings" },
  { id: "glutes", name: "Glutes" },
  { id: "calves", name: "Calves" },
  { id: "full_body", name: "Full body" },
  { id: "cardio", name: "Cardio" },
];

export const muscleName = (id: string) => MUSCLES.find((m) => m.id === id)?.name ?? id;

export const EQUIPMENT = ["barbell", "dumbbell", "machine", "cable", "bodyweight", "kettlebell", "band", "other"] as const;

export const MEASURES: { id: Measure; name: string }[] = [
  { id: "weight", name: "Weight and reps" },
  { id: "reps", name: "Reps" },
  { id: "time", name: "Time" },
  { id: "cardio", name: "Time and distance" },
];

/** Body measurements, in cm. */
export const MEASUREMENTS = [
  { key: "waist", label: "Waist" },
  { key: "chest", label: "Chest" },
  { key: "arms", label: "Arms" },
  { key: "thighs", label: "Thighs" },
  { key: "hips", label: "Hips" },
  { key: "neck", label: "Neck" },
] as const;

// ---------------------------------------------------------------------------
// Units. Weights are stored in kg.
// ---------------------------------------------------------------------------

export type Unit = "kg" | "lb";
const LB = 2.20462;

/** A stored kg value in the display unit, rounded to 0.1. */
export function toUnit(kg: number, unit: Unit) {
  return Math.round((unit === "lb" ? kg * LB : kg) * 10) / 10;
}

/** A typed value in the display unit, as kg. */
export function fromUnit(value: number, unit: Unit) {
  return unit === "lb" ? value / LB : value;
}

export function formatWeight(kg: number, unit: Unit) {
  return `${toUnit(kg, unit).toLocaleString()} ${unit}`;
}

/** Large volumes read as "12.4 t" (or "27.3k lb"). */
export function formatVolume(kg: number, unit: Unit) {
  const v = unit === "lb" ? kg * LB : kg;
  if (unit === "kg" && v >= 1000) return `${(Math.round(v / 100) / 10).toLocaleString()} t`;
  if (unit === "lb" && v >= 10000) return `${(Math.round(v / 100) / 10).toLocaleString()}k lb`;
  return `${Math.round(v).toLocaleString()} ${unit}`;
}

export function formatSeconds(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** "1 h 5 min", "45 min". */
export function formatDuration(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}` : `${min} min`;
}

// ---------------------------------------------------------------------------
// Sets
// ---------------------------------------------------------------------------

type SetLike = Pick<WorkoutSet, "weight" | "reps" | "seconds" | "distance" | "warmup" | "done">;

/** Estimated one-rep max (Epley); a single is its own max, high-rep sets are not trusted. */
export function e1rm(weight: number | null, reps: number | null) {
  if (!weight || !reps || reps < 1 || reps > 12) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/** A set that counts: done, not a warm-up. */
export const isWorking = (s: SetLike) => s.done && !s.warmup;

/** Kg moved in a set (weight × reps). */
export const setVolume = (s: SetLike) => (isWorking(s) ? (s.weight ?? 0) * (s.reps ?? 0) : 0);

export function volumeOf(sets: SetLike[]) {
  return sets.reduce((n, s) => n + setVolume(s), 0);
}

/** "60 kg × 8", "12 reps", "1:30", "5 km in 25:00". */
export function describeSet(s: SetLike, measure: Measure, unit: Unit) {
  switch (measure) {
    case "weight":
      return `${toUnit(s.weight ?? 0, unit)} ${unit} × ${s.reps ?? 0}`;
    case "reps":
      return s.weight ? `${s.reps ?? 0} reps +${toUnit(s.weight, unit)} ${unit}` : `${s.reps ?? 0} reps`;
    case "time":
      return formatSeconds(s.seconds ?? 0);
    case "cardio":
      return s.distance ? `${s.distance} km in ${formatSeconds(s.seconds ?? 0)}` : formatSeconds(s.seconds ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export type RecordKind = "weight" | "e1rm" | "volume" | "reps" | "time" | "distance";

export const RECORD_LABELS: Record<RecordKind, string> = {
  weight: "Heaviest weight",
  e1rm: "Best estimated 1RM",
  volume: "Best set volume",
  reps: "Most reps",
  time: "Longest time",
  distance: "Longest distance",
};

/** A record's label inside a sentence: "best estimated 1RM". */
export const recordLabelInline = (kind: RecordKind) => RECORD_LABELS[kind].charAt(0).toLowerCase() + RECORD_LABELS[kind].slice(1);

/** Which records an exercise keeps. */
export function recordKinds(measure: Measure): RecordKind[] {
  switch (measure) {
    case "weight":
      return ["weight", "e1rm", "volume"];
    case "reps":
      return ["reps"];
    case "time":
      return ["time"];
    case "cardio":
      return ["distance", "time"];
  }
}

function recordValue(kind: RecordKind, s: SetLike) {
  switch (kind) {
    case "weight":
      return s.reps ? (s.weight ?? 0) : 0;
    case "e1rm":
      return e1rm(s.weight, s.reps);
    case "volume":
      return (s.weight ?? 0) * (s.reps ?? 0);
    case "reps":
      return s.reps ?? 0;
    case "time":
      return s.seconds ?? 0;
    case "distance":
      return s.distance ?? 0;
  }
}

export interface Best<S> {
  kind: RecordKind;
  value: number;
  set: S;
}

/** The best working set for each record kind. */
export function bests<S extends SetLike>(sets: S[], measure: Measure): Best<S>[] {
  const out: Best<S>[] = [];
  for (const kind of recordKinds(measure)) {
    let best: Best<S> | null = null;
    for (const s of sets) {
      if (!isWorking(s)) continue;
      const value = recordValue(kind, s);
      if (value > 0 && (!best || value > best.value)) best = { kind, value, set: s };
    }
    if (best) out.push(best);
  }
  return out;
}

export interface NewRecord {
  exerciseId: string;
  kind: RecordKind;
  value: number;
  setId: string;
}

/**
 * Records a workout set: for each exercise and kind, its best set if it beats
 * every earlier finished workout. A first time doing an exercise sets none.
 */
export function workoutRecords(workout: Pick<Workout, "id" | "startedAt">, sets: WorkoutSet[], workouts: Workout[], exercises: Map<string, Exercise>): NewRecord[] {
  const earlier = new Set(workouts.filter((w) => w.id !== workout.id && w.endedAt && w.startedAt < workout.startedAt).map((w) => w.id));
  const mine = sets.filter((s) => s.workoutId === workout.id);
  const out: NewRecord[] = [];
  for (const exerciseId of new Set(mine.map((s) => s.exerciseId))) {
    const ex = exercises.get(exerciseId);
    if (!ex) continue;
    const before = sets.filter((s) => s.exerciseId === exerciseId && earlier.has(s.workoutId));
    if (!before.some(isWorking)) continue;
    const old = new Map(bests(before, ex.measure).map((b) => [b.kind, b.value]));
    for (const b of bests(
      mine.filter((s) => s.exerciseId === exerciseId),
      ex.measure,
    )) {
      if (b.value > (old.get(b.kind) ?? 0) + 1e-9) out.push({ exerciseId, kind: b.kind, value: b.value, setId: b.set.id });
    }
  }
  return out;
}

/** What a record's value reads as. */
export function formatRecord(kind: RecordKind, value: number, unit: Unit) {
  switch (kind) {
    case "weight":
    case "e1rm":
      return formatWeight(value, unit);
    case "volume":
      return formatVolume(value, unit);
    case "reps":
      return `${value} reps`;
    case "time":
      return formatSeconds(value);
    case "distance":
      return `${Math.round(value * 100) / 100} km`;
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/** The sets of an exercise from its most recent finished workout before `before`. */
export function previousSets(exerciseId: string, sets: WorkoutSet[], workouts: Workout[], before: number, excludeWorkout?: string): WorkoutSet[] {
  const done = workouts
    .filter((w) => w.endedAt && w.startedAt < before && w.id !== excludeWorkout)
    .sort((a, b) => b.startedAt - a.startedAt);
  for (const w of done) {
    const found = sets.filter((s) => s.workoutId === w.id && s.exerciseId === exerciseId && s.done).sort((a, b) => a.setIndex - b.setIndex);
    if (found.length) return found;
  }
  return [];
}

/** One point per finished workout for an exercise's progress chart. */
export function progress(exercise: Exercise, sets: WorkoutSet[], workouts: Workout[]) {
  const kind = recordKinds(exercise.measure)[exercise.measure === "weight" ? 1 : 0];
  return workouts
    .filter((w) => w.endedAt)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((w) => {
      const best = bests(
        sets.filter((s) => s.workoutId === w.id && s.exerciseId === exercise.id),
        exercise.measure,
      ).find((b) => b.kind === kind);
      return best ? { at: w.startedAt, date: w.date, value: best.value } : null;
    })
    .filter((p): p is { at: number; date: string; value: number } => p !== null);
}

/** Working sets per muscle in `from..to`. */
export function setsPerMuscle(sets: WorkoutSet[], workouts: Workout[], exercises: Map<string, Exercise>, from: DateKey, to: DateKey) {
  const inRange = new Set(workouts.filter((w) => w.endedAt && w.date >= from && w.date <= to).map((w) => w.id));
  const out = new Map<Muscle, number>();
  for (const s of sets) {
    if (!inRange.has(s.workoutId) || !isWorking(s)) continue;
    const muscle = exercises.get(s.exerciseId)?.muscle;
    if (muscle) out.set(muscle, (out.get(muscle) ?? 0) + 1);
  }
  return out;
}

/** Volume and sessions for each of the last `weeks` weeks (Monday first), oldest first. */
export function weeklyTotals(workouts: Workout[], today: DateKey, weeks: number) {
  const start = weekStart(today);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDaysKey(start, (i - weeks + 1) * 7);
    const to = addDaysKey(from, 6);
    const done = workouts.filter((w) => w.endedAt && w.date >= from && w.date <= to);
    return { from, sessions: done.length, volume: done.reduce((n, w) => n + w.volume, 0) };
  });
}

// ---------------------------------------------------------------------------
// Starter routines
// ---------------------------------------------------------------------------

const item = (slug: string, sets: number, reps: number | null): TemplateItem => ({ exerciseId: `ex:${slug}`, sets, reps });

export const STARTER_ROUTINES: { name: string; exercises: TemplateItem[] }[] = [
  {
    name: "Push",
    exercises: [item("bench-press", 4, 6), item("overhead-press", 3, 8), item("incline-dumbbell-press", 3, 10), item("lateral-raise", 3, 15), item("triceps-pushdown", 3, 12)],
  },
  {
    name: "Pull",
    exercises: [item("deadlift", 3, 5), item("pull-up", 3, 8), item("barbell-row", 3, 8), item("face-pull", 3, 15), item("hammer-curl", 3, 12)],
  },
  {
    name: "Legs",
    exercises: [item("squat", 4, 6), item("romanian-deadlift", 3, 8), item("leg-press", 3, 12), item("lying-leg-curl", 3, 12), item("standing-calf-raise", 4, 15)],
  },
];
