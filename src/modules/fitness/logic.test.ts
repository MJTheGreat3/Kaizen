import { describe, expect, it } from "vitest";

import type { Exercise, Workout, WorkoutSet } from "@/core/db/schema";
import { bests, describeSet, e1rm, formatVolume, fromUnit, previousSets, progress, setsPerMuscle, toUnit, volumeOf, weeklyTotals, workoutRecords } from "./logic";

const exercise = (id: string, measure: Exercise["measure"] = "weight", muscle: Exercise["muscle"] = "chest") =>
  ({ id, name: id, muscle, measure, equipment: "barbell", notes: null, isBuiltin: true }) as Exercise;

const workout = (id: string, date: string, startedAt: number, volume = 0, ended = true) =>
  ({ id, name: id, date, startedAt, endedAt: ended ? startedAt + 3_600_000 : null, volume, templateId: null, notes: null }) as Workout;

let n = 0;
const set = (workoutId: string, exerciseId: string, weight: number | null, reps: number | null, extra: Partial<WorkoutSet> = {}) =>
  ({ id: `s${n++}`, workoutId, exerciseId, position: 0, setIndex: n, warmup: false, weight, reps, seconds: null, distance: null, rpe: null, done: true, ...extra }) as WorkoutSet;

describe("gym logic", () => {
  it("estimates one-rep max", () => {
    expect(e1rm(100, 1)).toBe(100);
    expect(e1rm(100, 5)).toBeCloseTo(116.67, 1);
    expect(e1rm(100, 20)).toBe(0);
    expect(e1rm(null, 5)).toBe(0);
  });

  it("converts units and formats", () => {
    expect(toUnit(100, "lb")).toBe(220.5);
    expect(fromUnit(220.462, "lb")).toBeCloseTo(100, 2);
    expect(formatVolume(12_400, "kg")).toBe("12.4 t");
    expect(formatVolume(800, "kg")).toBe("800 kg");
    expect(describeSet(set("w", "e", 60, 8), "weight", "kg")).toBe("60 kg × 8");
    expect(describeSet(set("w", "e", null, null, { seconds: 90 }), "time", "kg")).toBe("1:30");
  });

  it("counts only working sets in volume", () => {
    expect(volumeOf([set("w", "e", 100, 5), set("w", "e", 40, 10, { warmup: true }), set("w", "e", 100, 5, { done: false })])).toBe(500);
  });

  it("finds bests and new records", () => {
    const bench = exercise("bench");
    const ex = new Map([["bench", bench]]);
    const w1 = workout("w1", "2026-10-01", 1000);
    const w2 = workout("w2", "2026-10-08", 2000);
    const sets = [set("w1", "bench", 80, 5), set("w1", "bench", 70, 10), set("w2", "bench", 85, 3), set("w2", "bench", 60, 8)];
    const b = bests(sets.slice(0, 2), "weight");
    expect(b.find((x) => x.kind === "weight")?.value).toBe(80);
    expect(b.find((x) => x.kind === "volume")?.value).toBe(700);
    // The first workout sets no records; the second beats weight and e1rm (85 × 3 ≈ 93.5), not volume.
    expect(workoutRecords(w1, sets, [w1, w2], ex)).toEqual([]);
    const records = workoutRecords(w2, sets, [w1, w2], ex).map((r) => r.kind);
    expect(records).toEqual(["weight", "e1rm"]);
  });

  it("finds the previous sets and progress", () => {
    const bench = exercise("bench");
    const w1 = workout("w1", "2026-10-01", 1000);
    const w2 = workout("w2", "2026-10-08", 2000);
    const live = workout("w3", "2026-10-14", 3000, 0, false);
    const sets = [set("w1", "bench", 80, 5), set("w2", "bench", 82.5, 5), set("w3", "bench", 85, 5)];
    expect(previousSets("bench", sets, [w1, w2, live], 3000, "w3").map((s) => s.weight)).toEqual([82.5]);
    expect(progress(bench, sets, [w1, w2, live]).map((p) => Math.round(p.value))).toEqual([93, 96]);
  });

  it("totals weeks and muscles", () => {
    const ex = new Map([
      ["bench", exercise("bench")],
      ["squat", exercise("squat", "weight", "quads")],
    ]);
    const workouts = [workout("w1", "2026-10-13", 1, 1000), workout("w2", "2026-10-06", 1, 500), workout("w3", "2026-10-14", 1, 0, false)];
    const weeks = weeklyTotals(workouts, "2026-10-14", 2);
    expect(weeks).toEqual([
      { from: "2026-10-05", sessions: 1, volume: 500 },
      { from: "2026-10-12", sessions: 1, volume: 1000 },
    ]);
    const sets = [set("w1", "bench", 60, 8), set("w1", "squat", 100, 5), set("w1", "squat", 60, 5, { warmup: true }), set("w2", "bench", 60, 8)];
    const muscles = setsPerMuscle(sets, workouts, ex, "2026-10-12", "2026-10-18");
    expect([...muscles]).toEqual([
      ["chest", 1],
      ["quads", 1],
    ]);
  });
});
