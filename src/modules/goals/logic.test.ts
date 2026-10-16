import { describe, expect, it } from "vitest";

import { cumulative, justReached, progress, type GoalInputs } from "./logic";

const none: GoalInputs = { entries: [], activity: [], checkIns: [], tasks: [] };
const base = { startValue: 0, targetValue: 100, startDate: "2026-10-01", targetDate: null, status: "active" as const };

describe("goal progress", () => {
  it("tracks a manual metric that goes up or down", () => {
    const rating = { ...base, kind: "manual" as const, startValue: 1400, targetValue: 1600 };
    const p = progress(rating, { ...none, entries: [{ date: "2026-10-05", value: 1450 }, { date: "2026-10-03", value: 1420 }] }, "2026-10-14");
    expect(p.current).toBe(1450);
    expect(p.fraction).toBe(0.25);
    expect(p.series.map((x) => x.value)).toEqual([1420, 1450]);

    const weight = { ...base, kind: "manual" as const, startValue: 80, targetValue: 70 };
    expect(progress(weight, { ...none, entries: [{ date: "2026-10-05", value: 75 }] }, "2026-10-14").fraction).toBe(0.5);
    expect(progress(weight, none, "2026-10-14").current).toBe(80);
  });

  it("totals activity since the start date", () => {
    const g = { ...base, kind: "activity" as const, targetValue: 10 };
    const activity = [
      { date: "2026-09-30", value: 5 },
      { date: "2026-10-02", value: 3 },
      { date: "2026-10-02", value: 1 },
      { date: "2026-10-04", value: 2 },
    ];
    const p = progress(g, { ...none, activity }, "2026-10-14");
    expect(p.current).toBe(6);
    expect(p.series).toEqual([
      { date: "2026-10-02", value: 4 },
      { date: "2026-10-04", value: 6 },
    ]);
  });

  it("counts linked tasks and habit check-ins", () => {
    const tasks = progress({ ...base, kind: "tasks" }, { ...none, tasks: [{ done: true, completedOn: "2026-10-03" }, { done: false, completedOn: null }] }, "2026-10-14");
    expect([tasks.current, tasks.target, tasks.fraction]).toEqual([1, 2, 0.5]);
    const habits = progress({ ...base, kind: "habits", targetValue: 4 }, { ...none, checkIns: ["2026-10-02", "2026-10-02", "2026-10-03"] }, "2026-10-14");
    expect(habits.current).toBe(3);
  });

  it("judges pace against the target date", () => {
    const g = { ...base, kind: "activity" as const, targetValue: 30, targetDate: "2026-10-31" };
    // Day 13 of 30: about 13 expected.
    const behind = progress(g, { ...none, activity: [{ date: "2026-10-02", value: 5 }] }, "2026-10-14");
    expect(behind.pace).toBe("behind");
    expect(behind.daysLeft).toBe(17);
    expect(behind.perDay).toBeCloseTo(25 / 18);
    expect(progress(g, { ...none, activity: [{ date: "2026-10-02", value: 20 }] }, "2026-10-14").pace).toBe("ahead");
    expect(progress(g, none, "2026-11-02").pace).toBe("overdue");
    const done = progress(g, { ...none, activity: [{ date: "2026-10-02", value: 30 }] }, "2026-10-14");
    expect(done.pace).toBe("done");
    expect(justReached(g, done)).toBe(true);
    expect(justReached({ ...g, status: "done" }, done)).toBe(false);
  });

  it("never completes a task goal with no tasks", () => {
    const p = progress({ ...base, kind: "tasks" }, none, "2026-10-14");
    expect(justReached({ ...base, kind: "tasks" }, p)).toBe(false);
  });

  it("builds running totals", () => {
    expect(cumulative([{ date: "2026-10-02", value: 2 }, { date: "2026-10-01", value: 1 }], "2026-10-01").map((p) => p.value)).toEqual([1, 3]);
  });

  it("treats a check goal as done or not, with no auto-completion", () => {
    const g = { ...base, kind: "manual" as const, targetValue: 1, metric: "check", targetDate: "2026-10-10" };
    const open = progress(g, { ...none, entries: [{ date: "2026-10-05", value: 5 }] }, "2026-10-14");
    expect(open).toMatchObject({ fraction: 0, current: 0, target: 1, pace: "overdue" });
    expect(justReached(g, open)).toBe(false);
    expect(progress({ ...g, status: "done" }, none, "2026-10-14")).toMatchObject({ fraction: 1, pace: "done" });
    expect(progress({ ...g, targetDate: null }, none, "2026-10-14").pace).toBe("none");
  });
});
