import { describe, expect, it } from "vitest";

import type { FocusSession, FocusUnlock } from "@/core/db/schema";
import { coins, elapsedMs, formatClock, progress, remainingMs, stats } from "./logic";

const base = { createdAt: 0, updatedAt: 0, deletedAt: null, deviceId: "d" };
const MIN = 60_000;
const t0 = new Date(2026, 9, 13, 9, 0).getTime();

function session(over: Partial<FocusSession> = {}): FocusSession {
  return {
    id: "s",
    date: "2026-10-13",
    startedAt: t0,
    plannedMinutes: 25,
    status: "running",
    pausedAt: null,
    pausedMs: 0,
    endedAt: null,
    focusedMinutes: 0,
    tag: null,
    taskId: null,
    species: "oak",
    strict: false,
    note: null,
    ...base,
    ...over,
  };
}

describe("focus timer", () => {
  it("counts focused time without pauses", () => {
    const s = session({ pausedMs: 5 * MIN });
    expect(elapsedMs(s, t0 + 15 * MIN)).toBe(10 * MIN);
    expect(remainingMs(s, t0 + 15 * MIN)).toBe(15 * MIN);
    expect(progress(s, t0 + 15 * MIN)).toBeCloseTo(0.4);

    // While paused, time stands still.
    const paused = session({ status: "paused", pausedAt: t0 + 10 * MIN });
    expect(elapsedMs(paused, t0 + 30 * MIN)).toBe(10 * MIN);

    // Finished sessions stop at their end.
    const done = session({ status: "completed", endedAt: t0 + 25 * MIN });
    expect(elapsedMs(done, t0 + 60 * MIN)).toBe(25 * MIN);
    expect(progress(done, t0 + 60 * MIN)).toBe(1);
  });

  it("formats the clock", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(61_500)).toBe("1:02");
    expect(formatClock(90 * MIN)).toBe("1:30:00");
  });

  it("earns coins for completed minutes and spends them on species", () => {
    const sessions = [
      session({ id: "a", status: "completed", focusedMinutes: 25 }),
      session({ id: "b", status: "withered", focusedMinutes: 12 }),
      session({ id: "c", status: "completed", focusedMinutes: 50.7 }),
    ];
    const unlocks = [{ id: "cherry", ...base } as FocusUnlock];
    expect(coins(sessions, [])).toEqual({ earned: 75, spent: 0, balance: 75 });
    expect(coins(sessions, unlocks).balance).toBe(75 - 300);
  });

  it("summarises days, tags and the best hour", () => {
    const now = new Date(2026, 9, 13, 20, 0);
    const s = stats(
      [
        session({ id: "a", status: "completed", focusedMinutes: 25, tag: "dsa" }),
        session({ id: "b", status: "completed", focusedMinutes: 50, tag: "dsa", startedAt: t0 + 5 * 60 * MIN }),
        session({ id: "c", status: "completed", focusedMinutes: 30, date: "2026-10-01", tag: "study", startedAt: t0 + 9 * 60 * MIN }),
        session({ id: "d", status: "withered", focusedMinutes: 3 }),
      ],
      now,
    );
    expect(s.todayMinutes).toBe(75);
    expect(s.weekMinutes).toBe(75);
    expect(s.totalMinutes).toBe(105);
    expect(s.completed).toBe(3);
    expect(s.withered).toBe(1);
    expect(s.longestMinutes).toBe(50);
    expect(s.tags[0]).toEqual({ tag: "dsa", minutes: 75 });
    expect(s.bestHour).toBe(14);
    expect(s.days.at(-1)).toEqual({ date: "2026-10-13", minutes: 75 });
  });
});
