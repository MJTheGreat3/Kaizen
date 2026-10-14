import { describe, expect, it } from "vitest";

import type { SearchRow } from "@/core/db/schema";
import { distance, highlight, labelScore, parseQuery, search } from "./match";

const row = (r: Partial<SearchRow> & { title: string }): SearchRow => ({
  src: "tasks",
  refId: r.title,
  module: "todo",
  body: "",
  tags: "",
  date: null,
  amount: null,
  status: null,
  ...r,
});

const rows: SearchRow[] = [
  row({ title: "Submit OS assignment", tags: "college", date: "2026-10-17", status: "open" }),
  row({ title: "Dune Messiah", module: "read", body: "Frank Herbert", tags: "scifi" }),
  row({ title: "Swiggy dinner", src: "debts", module: "debts", body: "Rahul", amount: 450, date: "2026-09-12", status: "owed_to_me" }),
  row({ title: "Café ideas for the weekend", module: "ideas", date: "2026-08-01" }),
  row({ title: "OS lab record", tags: "college", status: "done", date: "2026-09-02" }),
  row({ title: "Knapsack for Beginners", src: "cp_problems", module: "problems", body: "codeforces 1700A", tags: "dp", amount: 1700, status: "solved" }),
];
const titles = (q: string) => search(rows, parseQuery(q)).map((r) => r.row.title);

describe("search", () => {
  it("matches prefixes and substrings across title, tags and body", () => {
    expect(titles("assign")).toEqual(["Submit OS assignment"]);
    expect(titles("herb")).toEqual(["Dune Messiah"]);
    expect(titles("ssiah")).toEqual(["Dune Messiah"]);
    expect(titles("cafe")).toEqual(["Café ideas for the weekend"]);
  });

  it("forgives typos in longer words", () => {
    expect(titles("mesiah")).toEqual(["Dune Messiah"]);
    expect(titles("asignment")).toEqual(["Submit OS assignment"]);
    expect(titles("dnue")).toEqual(["Dune Messiah"]);
    // Short words must be exact.
    expect(titles("ox")).toEqual([]);
  });

  it("needs every word and ranks open and title matches higher", () => {
    expect(titles("os college")).toEqual(["Submit OS assignment", "OS lab record"]);
    expect(titles("os rahul")).toEqual([]);
  });

  it("applies filters", () => {
    expect(titles("in:debts")).toEqual(["Swiggy dinner"]);
    expect(titles("in:finance swiggy")).toEqual([]);
    expect(titles("tag:college")).toHaveLength(2);
    expect(titles("#coll os")).toHaveLength(2);
    expect(titles("before:2026-09-01")).toEqual(["Café ideas for the weekend"]);
    expect(titles("after:2026-09 college")).toEqual(["Submit OS assignment", "OS lab record"]);
    expect(titles("amount:>400")).toEqual(["Swiggy dinner"]);
    expect(titles("amount:<400")).toEqual([]);
    expect(titles("is:done")).toEqual(["OS lab record"]);
    expect(titles("in:lists")).toHaveLength(3);
    expect(titles("in:cp rating:>=1600 #dp")).toEqual(["Knapsack for Beginners"]);
    expect(titles("is:solved")).toEqual(["Knapsack for Beginners"]);
  });

  it("highlights the matched parts of the title", () => {
    const [hit] = search(rows, parseQuery("mess"));
    expect(highlight(hit.row.title, hit.ranges)).toEqual([
      { text: "Dune ", hit: false },
      { text: "Mess", hit: true },
      { text: "iah", hit: false },
    ]);
  });

  it("scores command labels", () => {
    expect(labelScore("Start focus", ["foc"])).toBeGreaterThan(0);
    expect(labelScore("Start focus", ["sart"])).toBeGreaterThan(0);
    expect(labelScore("Start focus", ["habit"])).toBe(0);
  });

  it("measures edit distance with transpositions", () => {
    expect(distance("dnue", "dune", 2)).toBe(1);
    expect(distance("kitten", "sitting", 3)).toBe(3);
    expect(distance("a", "abcdef", 2)).toBe(3);
  });
});
