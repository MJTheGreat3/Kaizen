import { describe, expect, it } from "vitest";

import { days, delta, habitRate, hoursMinutes, periodLabel, periodOf, shift, summarize } from "./logic";

describe("periods", () => {
  it("finds the Monday-to-Sunday week and the month", () => {
    expect(periodOf("week", "2026-10-15")).toEqual({ kind: "week", start: "2026-10-12", end: "2026-10-18" });
    expect(periodOf("week", "2026-10-18").start).toBe("2026-10-12");
    expect(periodOf("month", "2026-02-10")).toEqual({ kind: "month", start: "2026-02-01", end: "2026-02-28" });
  });

  it("steps back and forward", () => {
    expect(shift(periodOf("week", "2026-10-15"), -1).start).toBe("2026-10-05");
    expect(shift(periodOf("month", "2026-01-31"), -1)).toEqual({
      kind: "month",
      start: "2025-12-01",
      end: "2025-12-31",
    });
    expect(days(periodOf("week", "2026-10-15"))).toHaveLength(7);
  });

  it("labels periods", () => {
    expect(periodLabel(periodOf("week", "2026-10-15"), 2026)).toBe("12 – 18 Oct");
    expect(periodLabel(periodOf("week", "2026-10-01"), 2026)).toMatch(/^28 Sept? – 4 Oct$/);
  });
});

describe("summaries", () => {
  it("counts activity per type and day within the period", () => {
    const p = periodOf("week", "2026-10-15");
    const s = summarize(
      [
        { typeId: "gym", date: "2026-10-12", quantity: 1 },
        { typeId: "cp", date: "2026-10-12", quantity: 1 },
        { typeId: "cp", date: "2026-10-14", quantity: 1 },
        { typeId: "cp", date: "2026-10-20", quantity: 1 },
      ],
      p,
    );
    expect(s.activeDays).toBe(2);
    expect(s.counts.get("cp")).toBe(2);
    expect(s.bestDay).toEqual({ day: "2026-10-12", count: 2 });
  });

  it("rates habits by what was planned", () => {
    const p = periodOf("week", "2026-10-12");
    const habits = [
      { kind: "check" as const, target: 1, startDate: "2026-01-01", schedule: { type: "daily" as const } },
      {
        kind: "check" as const,
        target: 1,
        startDate: "2026-01-01",
        schedule: { type: "weekdays" as const, days: [1, 3] },
      },
    ];
    const logs = new Set(["0:2026-10-12", "0:2026-10-13", "1:2026-10-12"]);
    // Up to Wednesday: daily planned 3, done 2; Mon/Wed planned 2, done 1.
    expect(habitRate(habits, (h, d) => logs.has(`${h}:${d}`), p, "2026-10-14")).toBeCloseTo(3 / 5);
    expect(habitRate([], () => false, p, "2026-10-14")).toBeNull();
  });

  it("compares with the previous period", () => {
    expect(delta(5, 3)).toEqual({ text: "+2", up: true });
    expect(delta(80, 100, true)).toEqual({ text: "−20%", up: false });
    expect(delta(4, 4)).toBeNull();
    expect(delta(4, 0, true)).toBeNull();
    expect(hoursMinutes(200)).toBe("3 h 20 min");
  });
});
