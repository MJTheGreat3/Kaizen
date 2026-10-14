/**
 * Pure competitive-programming maths: rank colours, topic strength,
 * difficulty spread and the revisit schedule.
 */
import type { CpPlatform, CpProblem } from "@/core/db/schema";
import { addDaysKey, toKey, type DateKey } from "@/lib/dates";

export interface PlatformInfo {
  id: CpPlatform;
  name: string;
  /** Series colour (a CSS variable with light and dark steps). */
  color: string;
  profile: (handle: string) => string;
  handleLabel: string;
}

export const PLATFORMS: PlatformInfo[] = [
  { id: "codeforces", name: "Codeforces", color: "var(--cp-codeforces)", profile: (h) => `https://codeforces.com/profile/${h}`, handleLabel: "Handle" },
  { id: "leetcode", name: "LeetCode", color: "var(--cp-leetcode)", profile: (h) => `https://leetcode.com/u/${h}/`, handleLabel: "Username" },
  { id: "atcoder", name: "AtCoder", color: "var(--cp-atcoder)", profile: (h) => `https://atcoder.jp/users/${h}`, handleLabel: "User name" },
  { id: "codechef", name: "CodeChef", color: "var(--cp-codechef)", profile: (h) => `https://www.codechef.com/users/${h}`, handleLabel: "Handle" },
];

export const platformOf = (id: string) => PLATFORMS.find((p) => p.id === id);

/** Rating colours as each site shows them, lightened enough for dark mode. */
const BANDS: Record<CpPlatform, [number, string][]> = {
  codeforces: [
    [0, "#9aa0a6"],
    [1200, "#3fa34d"],
    [1400, "#22b3a7"],
    [1600, "#4a74f5"],
    [1900, "#b15ccf"],
    [2100, "#f0a03c"],
    [2400, "#ef5350"],
  ],
  atcoder: [
    [0, "#9aa0a6"],
    [400, "#a5714a"],
    [800, "#3fa34d"],
    [1200, "#22b3c0"],
    [1600, "#4a74f5"],
    [2000, "#c9b62a"],
    [2400, "#f0903c"],
    [2800, "#ef5350"],
  ],
  codechef: [
    [0, "#9aa0a6"],
    [1400, "#3fa34d"],
    [1600, "#4a74f5"],
    [1800, "#9d6bd8"],
    [2000, "#d6b62a"],
    [2200, "#f0903c"],
    [2500, "#ef5350"],
  ],
  leetcode: [
    [0, "#9aa0a6"],
    [1600, "#3fa34d"],
    [1850, "#4a74f5"],
    [2150, "#9d6bd8"],
    [2400, "#f0a020"],
  ],
};

export function ratingColor(platform: CpPlatform, rating: number | null | undefined): string {
  if (rating === null || rating === undefined) return "var(--muted-foreground)";
  let color = BANDS[platform][0][1];
  for (const [min, c] of BANDS[platform]) if (rating >= min) color = c;
  return color;
}

/** Colour for a problem's difficulty on its platform. */
export function difficultyColor(p: Pick<CpProblem, "platform" | "rating" | "difficulty">): string {
  if (p.platform === "leetcode") return p.difficulty === "Hard" ? "#ef5350" : p.difficulty === "Medium" ? "#f0a020" : "#22b3a7";
  if (p.platform === "codeforces" || p.platform === "atcoder") return ratingColor(p.platform, p.rating);
  return "var(--muted-foreground)";
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/** Different sites name the same topic differently. */
const TAG_ALIASES: Record<string, string> = {
  "dynamic programming": "dp",
  "hash table": "hashing",
  graph: "graphs",
  tree: "trees",
  "binary tree": "trees",
  "binary search tree": "trees",
  string: "strings",
  sorting: "sorting",
  sortings: "sorting",
  "depth-first search": "dfs and similar",
  "breadth-first search": "dfs and similar",
  "union find": "dsu",
  "number theory": "number theory",
  "bit manipulation": "bitmasks",
  "prefix sum": "prefix sums",
  "heap (priority queue)": "heaps",
  "two pointers": "two pointers",
  "sliding window": "two pointers",
  "shortest path": "shortest paths",
  geometry: "geometry",
  "brute force": "brute force",
  implementation: "implementation",
  simulation: "implementation",
  "segment tree": "data structures",
  "binary indexed tree": "data structures",
};

export function normalizeTag(tag: string): string {
  const t = tag.trim().toLowerCase();
  return TAG_ALIASES[t] ?? t;
}

export interface TagStat {
  tag: string;
  attempted: number;
  solved: number;
  /** Solved / attempted. */
  rate: number;
}

/** Per topic: problems tried and solved. */
export function tagStats(problems: Pick<CpProblem, "tags" | "solvedAt" | "attempts">[]): TagStat[] {
  const by = new Map<string, TagStat>();
  for (const p of problems) {
    for (const tag of new Set(p.tags.map(normalizeTag))) {
      const s = by.get(tag) ?? { tag, attempted: 0, solved: 0, rate: 0 };
      s.attempted++;
      if (p.solvedAt) s.solved++;
      by.set(tag, s);
    }
  }
  return [...by.values()].map((s) => ({ ...s, rate: s.attempted ? s.solved / s.attempted : 0 })).sort((a, b) => b.solved - a.solved);
}

/**
 * Weak spots: topics tried often enough to judge whose solve rate is well
 * below the overall one, worst first.
 */
export function weakTags(stats: TagStat[], minAttempted = 3, limit = 5): TagStat[] {
  const tried = stats.filter((s) => s.attempted >= minAttempted);
  const attempted = tried.reduce((n, s) => n + s.attempted, 0);
  const overall = attempted ? tried.reduce((n, s) => n + s.solved, 0) / attempted : 0;
  return tried
    .filter((s) => s.rate < overall - 0.1)
    .sort((a, b) => a.rate - b.rate || b.attempted - a.attempted)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export interface Bucket {
  label: string;
  count: number;
  color: string;
}

/** Solved problems by difficulty: rating bands of 200 for Codeforces and AtCoder. */
export function difficultyBuckets(platform: CpPlatform, problems: Pick<CpProblem, "platform" | "rating" | "difficulty" | "solvedAt">[]): Bucket[] {
  const solved = problems.filter((p) => p.platform === platform && p.solvedAt);
  if (platform === "leetcode") {
    return (["Easy", "Medium", "Hard"] as const).map((d) => ({
      label: d,
      count: solved.filter((p) => p.difficulty === d).length,
      color: difficultyColor({ platform, rating: null, difficulty: d }),
    }));
  }
  const rated = solved.filter((p) => p.rating !== null);
  if (!rated.length) return [];
  const step = 200;
  const lo = Math.floor(Math.min(...rated.map((p) => p.rating!)) / step) * step;
  const hi = Math.floor(Math.max(...rated.map((p) => p.rating!)) / step) * step;
  const out: Bucket[] = [];
  for (let b = lo; b <= hi; b += step) {
    out.push({
      label: String(b),
      count: rated.filter((p) => p.rating! >= b && p.rating! < b + step).length,
      color: ratingColor(platform, b + step / 2),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Revisit queue
// ---------------------------------------------------------------------------

/** Days until the next revisit after each successful one. */
export const REVISIT_DAYS = [1, 3, 7, 21];

export interface RevisitState {
  stage: number;
  dueDate: DateKey;
  status: "active" | "done";
}

export function startRevisit(today: DateKey): RevisitState {
  return { stage: 0, dueDate: addDaysKey(today, REVISIT_DAYS[0]), status: "active" };
}

/** After an attempt: solved moves to the next gap (done after the last), struggled starts over. */
export function nextRevisit(stage: number, solved: boolean, today: DateKey): RevisitState {
  if (!solved) return startRevisit(today);
  const next = stage + 1;
  if (next >= REVISIT_DAYS.length) return { stage: next, dueDate: today, status: "done" };
  return { stage: next, dueDate: addDaysKey(today, REVISIT_DAYS[next]), status: "active" };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/** Problems first solved per local day. */
export function solvesByDay(problems: Pick<CpProblem, "solvedAt">[]): Map<DateKey, number> {
  const out = new Map<DateKey, number>();
  for (const p of problems) {
    if (!p.solvedAt) continue;
    const d = toKey(new Date(p.solvedAt));
    out.set(d, (out.get(d) ?? 0) + 1);
  }
  return out;
}

export function solvedSince(problems: Pick<CpProblem, "solvedAt">[], from: DateKey): number {
  let n = 0;
  for (const p of problems) if (p.solvedAt && toKey(new Date(p.solvedAt)) >= from) n++;
  return n;
}

const ACRONYMS = new Set(["dp", "dsu", "fft", "dfs", "bfs", "sql", "2-sat"]);

/** "dp" -> "DP", "dfs and similar" -> "DFS and similar", "greedy" -> "Greedy". */
export function tagLabel(tag: string): string {
  const words = tag.split(" ").map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const first = words[0] ?? "";
  words[0] = first === first.toUpperCase() ? first : first.charAt(0).toUpperCase() + first.slice(1);
  return words.join(" ");
}
