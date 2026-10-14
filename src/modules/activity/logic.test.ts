import { describe, expect, it } from "vitest";

import { addDaysKey } from "@/lib/dates";
import { activeDays, activeWeeksRate, levels, ruleFor, streak, totalsByDay, weekColumns, weekStart } from "./logic";

const today = "2026-10-14"; // Wednesday
const back = (n: number) => addDaysKey(today, -n);
const set = (...days: string[]) => new Set(days);

describe("rules", () => {
  it("fills defaults per type and keeps saved values", () => {
    expect(ruleFor("focus", "{}").min).toBe(25);
    expect(ruleFor("gym", null).period).toBe("week");
    expect(ruleFor("focus", '{"min":50}').min).toBe(50);
    expect(ruleFor("tasks", "not json").min).toBe(1);
  });

  it("counts only days that reach the minimum", () => {
    const totals = totalsByDay([
      { typeId: "focus", date: back(1), quantity: 20 },
      { typeId: "focus", date: back(1), quantity: 10 },
      { typeId: "focus", date: back(2), quantity: 15 },
    ]);
    expect([...activeDays(totals.get("focus"), ruleFor("focus", "{}"))]).toEqual([back(1)]);
  });
});

describe("daily streaks", () => {
  const rule = ruleFor("tasks", "{}");

  it("keeps the streak alive until today is over", () => {
    const s = streak(set(back(3), back(2), back(1)), rule, today);
    expect(s).toMatchObject({ current: 3, longest: 3, since: back(3), doneNow: false });
    expect(streak(set(back(2), back(1), today), rule, today)).toMatchObject({ current: 3, doneNow: true });
  });

  it("breaks on a missed day and remembers the longest run", () => {
    const s = streak(set(back(9), back(8), back(7), back(6), back(4), back(1)), rule, today);
    expect(s.current).toBe(1);
    expect(s.longest).toBe(4);
  });

  it("bridges rest days and monthly freezes", () => {
    // back(2) is a Monday.
    const withRest = { ...rule, restDays: [1] };
    expect(streak(set(back(4), back(3), back(1)), withRest, today).current).toBe(3);
    const withFreeze = { ...rule, freezesPerMonth: 1 };
    expect(streak(set(back(5), back(4), back(2), back(1)), withFreeze, today).current).toBe(4);
    // Only one freeze a month.
    expect(streak(set(back(6), back(4), back(2), back(1)), withFreeze, today).current).toBe(2);
  });
});

describe("weekly streaks", () => {
  it("counts weeks with enough active days; this week is still open", () => {
    const rule = { ...ruleFor("gym", null), perWeek: 2 };
    const thisWeek = weekStart(today);
    const days = set(
      addDaysKey(thisWeek, -14),
      addDaysKey(thisWeek, -13),
      addDaysKey(thisWeek, -7),
      addDaysKey(thisWeek, -5),
      thisWeek,
    );
    expect(streak(days, rule, today)).toMatchObject({ current: 2, longest: 2, unit: "weeks", doneNow: false });
  });
});

describe("heatmap", () => {
  it("grades intensity by quartile of each type", () => {
    const days = new Map([
      ["2026-10-01", 1],
      ["2026-10-02", 2],
      ["2026-10-03", 3],
      ["2026-10-04", 10],
      ["2026-09-01", 50],
    ]);
    const l = levels(days, "2026-10-01", "2026-10-31");
    expect(l.get("2026-10-01")).toBe(1);
    expect(l.get("2026-10-04")).toBe(4);
    expect(l.has("2026-09-01")).toBe(false);
  });

  it("lays weeks out as Monday-first columns", () => {
    const cols = weekColumns("2026-10-01", today);
    expect(cols[0][0]).toBe("2026-09-28");
    expect(cols.at(-1)?.includes(today)).toBe(true);
  });

  it("rates weekly rules by weeks met", () => {
    const rule = { ...ruleFor("gym", null), perWeek: 2 };
    // Week of 12 Oct: two days; week of 5 Oct: one; week of 28 Sep: none.
    const active = set("2026-10-12", "2026-10-13", "2026-10-07");
    expect(activeWeeksRate(active, rule, "2026-09-28", today)).toBeCloseTo(1 / 3);
  });
});
