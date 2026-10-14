/**
 * Universal search, matched in memory over the rows of `search_index`
 * (a few thousand at most), so prefixes, substrings and typos all work.
 *
 * Query syntax: plain words must all match (title, tags or body), plus
 * filters `in:finance`, `tag:college`, `before:2026-09-01`, `after:2026-09`,
 * `amount:>500` (or `rating:>1600` for problems) and `is:done`.
 */
import type { SearchRow } from "@/core/db/schema";

type Op = "<" | ">" | "=" | "<=" | ">=";

export interface Filters {
  modules: string[] | null;
  tags: string[];
  before: string | null;
  after: string | null;
  /** `amount:` (money) or `rating:` (problem difficulty); both live in the amount column. */
  amount: { op: Op; value: number; rating: boolean } | null;
  is: string[];
}

export interface ParsedQuery {
  terms: string[];
  filters: Filters;
  /** True when the query has any filter, so an empty term list still searches. */
  filtered: boolean;
}

/** Words that `in:` accepts, mapped to search index modules. */
const MODULE_ALIASES: Record<string, string[]> = {
  lists: ["todo", "watch", "read"],
  tasks: ["todo"],
  todo: ["todo"],
  watch: ["watch"],
  movies: ["watch"],
  read: ["read"],
  books: ["read"],
  ideas: ["ideas"],
  habits: ["habits"],
  calendar: ["dates", "subjects"],
  dates: ["dates"],
  college: ["subjects"],
  subjects: ["subjects"],
  debts: ["debts", "people"],
  people: ["people"],
  goals: ["goals"],
  practice: ["problems"],
  problems: ["problems"],
  cp: ["problems"],
  sports: ["sports"],
  gym: ["fitness"],
  fitness: ["fitness"],
  workouts: ["fitness"],
  exercises: ["fitness"],
};

const STATUS_ALIASES: Record<string, string[]> = {
  done: ["done"],
  open: ["open", "in_progress", "active"],
  active: ["active"],
  pinned: ["pinned"],
  archived: ["archived"],
  solved: ["solved"],
  unsolved: ["attempted"],
};

/** Lower case without accents, so "café" finds "cafe". */
export function fold(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function parseQuery(input: string): ParsedQuery {
  const filters: Filters = { modules: null, tags: [], before: null, after: null, amount: null, is: [] };
  const terms: string[] = [];
  let filtered = false;
  for (const raw of input.trim().split(/\s+/)) {
    if (!raw) continue;
    const m = /^(in|tag|before|after|amount|rating|is):(.+)$/i.exec(raw);
    if (!m) {
      // `#tag` works like `tag:`.
      if (raw.length > 1 && raw.startsWith("#")) {
        filters.tags.push(fold(raw.slice(1)));
        filtered = true;
      } else terms.push(fold(raw));
      continue;
    }
    const [, key, value] = m;
    const v = fold(value);
    switch (key.toLowerCase()) {
      case "in": {
        const mods = MODULE_ALIASES[v] ?? Object.entries(MODULE_ALIASES).find(([k]) => k.startsWith(v))?.[1] ?? [v];
        filters.modules = [...(filters.modules ?? []), ...mods];
        break;
      }
      case "tag":
        filters.tags.push(v.replace(/^#/, ""));
        break;
      case "before":
        filters.before = v;
        break;
      case "after":
        filters.after = v;
        break;
      case "rating":
      case "amount": {
        const a = /^(<=|>=|<|>|=)?(\d+(?:\.\d+)?)$/.exec(v);
        if (a) filters.amount = { op: (a[1] as Op | undefined) ?? "=", value: Number(a[2]), rating: key.toLowerCase() === "rating" };
        break;
      }
      case "is":
        filters.is.push(...(STATUS_ALIASES[v] ?? [v]));
        break;
    }
    filtered = true;
  }
  return { terms, filters, filtered };
}

function passes(row: SearchRow, f: Filters): boolean {
  if (f.modules && !f.modules.includes(row.module)) return false;
  if (f.tags.length) {
    const tags = fold(row.tags).split(" ");
    if (!f.tags.every((t) => tags.some((x) => x.startsWith(t)))) return false;
  }
  // Dates compare as text, so `before:2026-09` means before September.
  if (f.before && !(row.date && row.date < f.before)) return false;
  if (f.after && !(row.date && row.date > f.after)) return false;
  if (f.amount) {
    if (row.amount === null || f.amount.rating !== (row.src === "cp_problems")) return false;
    const { op, value } = f.amount;
    const a = row.amount;
    const ok = op === "<" ? a < value : op === ">" ? a > value : op === "<=" ? a <= value : op === ">=" ? a >= value : Math.abs(a - value) < 0.005;
    if (!ok) return false;
  }
  if (f.is.length && !(row.status && f.is.includes(row.status))) return false;
  return true;
}

/** Edit distance with transpositions, giving up past `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length];
}

/** Typos allowed for a term: none for short words. */
const typos = (term: string) => (term.length >= 7 ? 2 : term.length >= 4 ? 1 : 0);

const WORD = /[\p{L}\p{N}]+/gu;

interface Hit {
  score: number;
  /** Title ranges to highlight, [start, end). */
  ranges: [number, number][];
}

/** How well one term matches a field; 0 for no match. */
function matchField(term: string, folded: string, ranges: [number, number][] | null): number {
  const at = folded.indexOf(term);
  if (at >= 0) {
    ranges?.push([at, at + term.length]);
    const wordStart = at === 0 || !/[\p{L}\p{N}]/u.test(folded[at - 1]);
    return (at === 0 ? 3 : wordStart ? 2 : 1) * (term.length >= 3 ? 1 : 0.6);
  }
  const max = typos(term);
  if (!max) return 0;
  // A typo in a word's beginning: compare against prefixes about as long as the term.
  for (const m of folded.matchAll(WORD)) {
    const word = m[0];
    if (word.length + max < term.length) continue;
    for (let len = Math.max(1, term.length - max); len <= Math.min(word.length, term.length + max); len++) {
      if (distance(term, word.slice(0, len), max) <= max) {
        ranges?.push([m.index, m.index + len]);
        return 0.7;
      }
    }
  }
  return 0;
}

export interface Result {
  row: SearchRow;
  score: number;
  ranges: [number, number][];
}

/** Rows matching the query, best first. */
export function search(rows: SearchRow[], query: ParsedQuery, limit = 60): Result[] {
  if (!query.terms.length && !query.filtered) return [];
  const out: Result[] = [];
  for (const row of rows) {
    if (!passes(row, query.filters)) continue;
    const title = fold(row.title);
    const tags = fold(row.tags);
    const body = fold(row.body);
    const hit: Hit = { score: 0, ranges: [] };
    let all = true;
    for (const term of query.terms) {
      const s = Math.max(matchField(term, title, null) * 3, matchField(term, tags, null) * 2, matchField(term, body, null));
      if (!s) {
        all = false;
        break;
      }
      // Recompute title ranges for highlighting only when the title matched.
      matchField(term, title, hit.ranges);
      hit.score += s;
    }
    if (!all) continue;
    // Finished things sink a little.
    if (row.status === "done" || row.status === "archived") hit.score *= 0.8;
    out.push({ row, score: hit.score, ranges: mergeRanges(hit.ranges) });
  }
  out.sort((a, b) => b.score - a.score || (b.row.date ?? "").localeCompare(a.row.date ?? ""));
  return out.slice(0, limit);
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const r of sorted) {
    const last = out.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([...r]);
  }
  return out;
}

/** Splits text into plain and highlighted parts. */
export function highlight(text: string, ranges: [number, number][]): { text: string; hit: boolean }[] {
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  for (const [a, b] of ranges) {
    if (a > i) parts.push({ text: text.slice(i, a), hit: false });
    parts.push({ text: text.slice(a, b), hit: true });
    i = b;
  }
  if (i < text.length) parts.push({ text: text.slice(i), hit: false });
  return parts;
}

/** Fuzzy score for short labels (commands, module names): 0 when it doesn't match. */
export function labelScore(label: string, terms: string[]): number {
  const folded = fold(label);
  let score = 0;
  for (const t of terms) {
    const s = matchField(t, folded, null);
    if (!s) return 0;
    score += s;
  }
  return score;
}
