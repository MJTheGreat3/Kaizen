import { describe, expect, it } from "vitest";

import { clock, elapsedMs, pagesCovered, totalsOf } from "./reading";

describe("reading sessions", () => {
  it("leaves pauses out of the time read", () => {
    const run = { taskId: "b", startedAt: 0, pausedAt: null, pausedMs: 60_000 };
    expect(elapsedMs(run, 10 * 60_000)).toBe(9 * 60_000);
    expect(elapsedMs({ ...run, pausedAt: 5 * 60_000 }, 10 * 60_000)).toBe(4 * 60_000);
  });

  it("shows a clock with hours only when needed", () => {
    expect(clock(65_000)).toBe("1:05");
    expect(clock(3_725_000)).toBe("1:02:05");
  });

  it("counts pages from where the book was", () => {
    expect(pagesCovered(40, 72)).toBe(32);
    expect(pagesCovered(undefined, 12)).toBe(12);
    expect(pagesCovered(40, 30)).toBe(0);
    expect(pagesCovered(40, null)).toBe(0);
    expect(totalsOf([{ minutes: 30, pages: 20 }, { minutes: 15, pages: 0 }])).toEqual({ sessions: 2, minutes: 45, pages: 20 });
  });
});
