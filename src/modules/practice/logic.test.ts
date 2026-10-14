import { describe, expect, it } from "vitest";

import { difficultyBuckets, nextRevisit, normalizeTag, ratingColor, startRevisit, tagLabel, tagStats, weakTags } from "./logic";

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

  it("finds weak topics among those tried enough", () => {
    const problems = [
      ...Array.from({ length: 6 }, () => p(["greedy"], true)),
      p(["dp"], true),
      p(["Dynamic Programming"], false),
      p(["dp"], false),
      p(["dp"], false),
      p(["graphs"], false),
    ];
    const stats = tagStats(problems);
    expect(stats.find((s) => s.tag === "dp")).toMatchObject({ attempted: 4, solved: 1, rate: 0.25 });
    // Graphs was tried once: too little to judge.
    expect(weakTags(stats).map((s) => s.tag)).toEqual(["dp"]);
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

  it("schedules revisits at growing gaps and restarts after a struggle", () => {
    expect(startRevisit("2026-10-14")).toEqual({ stage: 0, dueDate: "2026-10-15", status: "active" });
    expect(nextRevisit(0, true, "2026-10-15")).toEqual({ stage: 1, dueDate: "2026-10-18", status: "active" });
    expect(nextRevisit(2, true, "2026-10-25")).toEqual({ stage: 3, dueDate: "2026-11-15", status: "active" });
    expect(nextRevisit(3, true, "2026-11-15").status).toBe("done");
    expect(nextRevisit(2, false, "2026-10-25")).toEqual({ stage: 0, dueDate: "2026-10-26", status: "active" });
  });
});
