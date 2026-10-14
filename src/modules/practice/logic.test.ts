import { describe, expect, it } from "vitest";

import { difficultyBuckets, normalizeTag, ratingColor, solvedSince, tagLabel, weeklyContributions } from "./logic";

const p = (tags: string[], solved: boolean, rating: number | null = null, platform = "codeforces", difficulty: string | null = null) => ({
  tags,
  solvedAt: solved ? 1 : null,
  attempts: 1,
  rating,
  platform,
  difficulty,
});

describe("practice", () => {
  it("colours ratings by each site's bands", () => {
    expect(ratingColor("codeforces", 1199)).toBe(ratingColor("codeforces", 0));
    expect(ratingColor("codeforces", 1650)).not.toBe(ratingColor("codeforces", 1550));
    expect(ratingColor("atcoder", 850)).toBe("#3fa34d");
    expect(ratingColor("codeforces", null)).toContain("muted");
  });

  it("merges topic names across sites", () => {
    expect(normalizeTag("Dynamic Programming")).toBe("dp");
    expect(normalizeTag("dp")).toBe("dp");
    expect(normalizeTag("Hash Table")).toBe("hashing");
    expect([tagLabel("dp"), tagLabel("dfs and similar"), tagLabel("greedy")]).toEqual(["DP", "DFS and similar", "Greedy"]);
  });

  it("buckets solved problems by difficulty", () => {
    const cf = difficultyBuckets("codeforces", [p([], true, 800), p([], true, 950), p([], true, 1400), p([], false, 2000)]);
    expect(cf.map((b) => [b.label, b.count])).toEqual([
      ["800", 2],
      ["1000", 0],
      ["1200", 0],
      ["1400", 1],
    ]);
    const lc = difficultyBuckets("leetcode", [p([], true, null, "leetcode", "Medium"), p([], true, null, "leetcode", "Easy")]);
    expect(lc.map((b) => b.count)).toEqual([1, 1, 0]);
  });

  it("counts solves since a day and contributions by week", () => {
    const byDay = new Map([
      ["2026-10-01", 2],
      ["2026-10-12", 1],
      ["2026-10-14", 3],
    ]);
    expect(solvedSince(byDay, "2026-10-12")).toBe(4);
    const weeks = weeklyContributions(
      new Map([
        ["2026-10-05", 4],
        ["2026-10-11", 1],
        ["2026-10-14", 7],
      ]),
      "2026-10-01",
      "2026-10-14",
    );
    // Weeks start on Monday: 28 Sep, 5 Oct, 12 Oct.
    expect(weeks.map((w) => [w.week, w.count])).toEqual([
      ["2026-09-28", 0],
      ["2026-10-05", 5],
      ["2026-10-12", 7],
    ]);
  });
});
