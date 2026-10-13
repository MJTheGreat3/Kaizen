import { describe, expect, it } from "vitest";

import type { HabitSchedule } from "@/core/db/schema";
import { nextDue } from "./lists/recurrence";
import { completionRate, doneThisWeek, streaks, type DayValues } from "./habits/streaks";
import { occurrencesBetween, occurrencesOn, semesterWeek, statsFor, subjectStats } from "./calendar/attendance";
import { balances, splitEvenly, totals } from "./debts/balances";

describe("nextDue", () => {
  it("advances by the recurrence and skips past today", () => {
    expect(nextDue("daily", "2026-10-13", "2026-10-13")).toBe("2026-10-14");
    expect(nextDue("daily", "2026-10-01", "2026-10-13")).toBe("2026-10-14");
    expect(nextDue("weekly", "2026-10-13", "2026-10-13")).toBe("2026-10-20");
    expect(nextDue("monthly", "2026-01-31", "2026-01-31")).toBe("2026-02-28");
    expect(nextDue("yearly", null, "2026-10-13")).toBe("2027-10-13");
  });

  it("skips weekends for weekday tasks", () => {
    // 16 Oct 2026 is a Friday.
    expect(nextDue("weekdays", "2026-10-16", "2026-10-16")).toBe("2026-10-19");
  });
});

describe("habit streaks", () => {
  const daily = { kind: "check" as const, target: 1, schedule: { type: "daily" } as HabitSchedule, startDate: "2026-10-01" };
  const days = (...keys: string[]): DayValues => new Map(keys.map((k) => [k, 1]));

  it("counts the current streak without breaking on an unfinished today", () => {
    const v = days("2026-10-10", "2026-10-11", "2026-10-12");
    expect(streaks(daily, v, "2026-10-13")).toEqual({ current: 3, best: 3, unit: "days" });
    v.set("2026-10-13", 1);
    expect(streaks(daily, v, "2026-10-13").current).toBe(4);
  });

  it("resets after a missed day but remembers the best run", () => {
    const v = days("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-12");
    expect(streaks(daily, v, "2026-10-13")).toEqual({ current: 1, best: 4, unit: "days" });
  });

  it("only counts scheduled weekdays", () => {
    // Mon/Wed/Fri habit; 12 Oct 2026 is a Monday.
    const mwf = { ...daily, schedule: { type: "weekdays", days: [1, 3, 5] } as HabitSchedule };
    const v = days("2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12");
    expect(streaks(mwf, v, "2026-10-13").current).toBe(4);
  });

  it("needs the target for count habits", () => {
    const water = { ...daily, kind: "count" as const, target: 8 };
    const v: DayValues = new Map([
      ["2026-10-11", 8],
      ["2026-10-12", 5],
    ]);
    expect(streaks(water, v, "2026-10-13").current).toBe(0);
  });

  it("counts weeks for N-per-week habits", () => {
    const gym = { ...daily, schedule: { type: "weekly", times: 3 } as HabitSchedule, startDate: "2026-09-28" };
    // Weeks of 28 Sep and 5 Oct each have 3 sessions; this week has 1 so far.
    const v = days("2026-09-28", "2026-09-30", "2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09", "2026-10-12");
    expect(streaks(gym, v, "2026-10-13")).toEqual({ current: 2, best: 2, unit: "weeks" });
    expect(doneThisWeek(gym, v, "2026-10-13")).toBe(1);
  });

  it("computes the completion rate over scheduled days", () => {
    const v = days("2026-10-11", "2026-10-12");
    expect(completionRate(daily, v, "2026-10-13", 4)).toBeCloseTo(2 / 3);
  });
});

describe("timetable occurrences", () => {
  // Semester starts Monday 5 Oct 2026.
  const semester = { startDate: "2026-10-05", endDate: "2026-12-31" };
  const slots = [
    { id: "ds", subjectId: "DS", weekday: 2, startMin: 540, endMin: 600, kind: "lecture" as const, room: "A1", weekParity: "all" as const },
    { id: "lab", subjectId: "DS", weekday: 2, startMin: 840, endMin: 960, kind: "lab" as const, room: "L2", weekParity: "odd" as const },
  ];
  const ex = (e: Partial<Parameters<typeof occurrencesOn>[2][number]>) =>
    ({ id: "e", kind: "extra", date: "", endDate: null, slotId: null, subjectId: null, classKind: null, startMin: null, endMin: null, room: null, title: null, ...e }) as Parameters<typeof occurrencesOn>[2][number];

  it("numbers semester weeks from the first Monday", () => {
    expect(semesterWeek(semester, "2026-10-06")).toBe(1);
    expect(semesterWeek(semester, "2026-10-13")).toBe(2);
  });

  it("respects odd and even weeks", () => {
    expect(occurrencesOn(semester, slots, [], "2026-10-06").map((o) => o.slotId)).toEqual(["ds", "lab"]);
    expect(occurrencesOn(semester, slots, [], "2026-10-13").map((o) => o.slotId)).toEqual(["ds"]);
  });

  it("applies holidays, vacations, cancellations and extra classes", () => {
    const exceptions = [
      ex({ id: "h", kind: "holiday", date: "2026-10-20", title: "Dussehra" }),
      ex({ id: "v", kind: "vacation", date: "2026-11-01", endDate: "2026-11-08", title: "Break" }),
      ex({ id: "c", kind: "cancel", date: "2026-10-27", slotId: "ds" }),
      ex({ id: "x", kind: "extra", date: "2026-10-24", subjectId: "DS", classKind: "lecture", startMin: 600, endMin: 660 }),
    ];
    expect(occurrencesOn(semester, slots, exceptions, "2026-10-20")).toEqual([]);
    expect(occurrencesOn(semester, slots, exceptions, "2026-11-03")).toEqual([]);
    expect(occurrencesOn(semester, slots, exceptions, "2026-10-27")[0].cancelled).toBe(true);
    expect(occurrencesOn(semester, slots, exceptions, "2026-10-24")[0]).toMatchObject({ key: "2026-10-24:x:x", startMin: 600 });
  });
});

describe("attendance stats", () => {
  const occ = (date: string, i: number) => ({
    key: `${date}:${i}`,
    date,
    subjectId: "S",
    kind: "lecture" as const,
    startMin: 540,
    endMin: 600,
    room: null,
    slotId: String(i),
    extraId: null,
    cancelled: false,
    cancelId: null,
  });

  it("computes percent, skips and catch-up at 80%", () => {
    const held = Array.from({ length: 10 }, (_, i) => occ("2026-10-01", i));
    const marks = new Map(held.map((o, i) => [o.key, i < 9 ? ("present" as const) : ("absent" as const)]));
    const s = statsFor(held, marks, { day: "2026-10-02", minutes: 0 }, 80, "all", "unmarked");
    expect(s).toMatchObject({ attended: 9, held: 10, percent: 90, canSkip: 1, mustAttend: 0 });

    const low = new Map(held.map((o, i) => [o.key, i < 6 ? ("present" as const) : ("absent" as const)]));
    // 6/10 -> needs (0.8*10 - 6)/0.2 = 10 more classes in a row.
    expect(statsFor(held, low, { day: "2026-10-02", minutes: 0 }, 80, "all", "unmarked").mustAttend).toBe(10);
  });

  it("counts excused as present and treats unmarked per the setting", () => {
    const held = [occ("2026-10-01", 1), occ("2026-10-01", 2)];
    const marks = new Map([[held[0].key, "excused" as const]]);
    expect(statsFor(held, marks, { day: "2026-10-02", minutes: 0 }, 80, "all", "unmarked")).toMatchObject({ attended: 1, held: 1, unmarked: 1 });
    expect(statsFor(held, marks, { day: "2026-10-02", minutes: 0 }, 80, "all", "present")).toMatchObject({ attended: 2, held: 2 });
  });

  it("splits labs and tutorials when counted separately", () => {
    const semester = { startDate: "2026-10-05", endDate: "2026-10-31", target: 80, separateLabs: true, separateTutorials: false, unmarkedDefault: "unmarked" as const };
    const slots = [
      { id: "a", subjectId: "S", weekday: 1, startMin: 540, endMin: 600, kind: "lecture" as const, room: null, weekParity: "all" as const },
      { id: "b", subjectId: "S", weekday: 1, startMin: 600, endMin: 660, kind: "tutorial" as const, room: null, weekParity: "all" as const },
      { id: "c", subjectId: "S", weekday: 1, startMin: 840, endMin: 960, kind: "lab" as const, room: null, weekParity: "all" as const },
    ];
    const all = occurrencesBetween(semester, slots, [], semester.startDate, semester.endDate);
    const stats = subjectStats({ id: "S", target: null }, semester, all, [], { day: "2026-10-01", minutes: 0 });
    expect(stats.map((s) => [s.component, s.remaining])).toEqual([
      ["lecture", 8],
      ["lab", 4],
    ]);
  });
});

describe("debt balances", () => {
  it("nets debts and repayments per person", () => {
    const b = balances(
      [
        { personId: "rahul", direction: "owed_to_me", amountPaise: 25000 },
        { personId: "rahul", direction: "owed_to_me", amountPaise: 40000 },
        { personId: "priya", direction: "i_owe", amountPaise: 120000 },
      ],
      [
        { personId: "rahul", direction: "to_me", amountPaise: 10000 },
        { personId: "priya", direction: "from_me", amountPaise: 20000 },
      ],
    );
    expect(b.get("rahul")).toBe(55000);
    expect(b.get("priya")).toBe(-100000);
    expect(totals(b)).toEqual({ owedToMe: 55000, iOwe: 100000, net: -45000 });
  });

  it("splits a bill without losing paise", () => {
    expect(splitEvenly(100000, 3)).toEqual([33334, 33333, 33333]);
  });
});
