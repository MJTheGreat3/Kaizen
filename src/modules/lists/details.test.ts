import { describe, expect, it } from "vitest";

import type { MediaFound } from "@/lib/ipc";
import { detailLine, exactMatch, metaFrom } from "./details";

const found = (over: Partial<MediaFound>): MediaFound => ({
  sourceId: "imdb:tt1",
  title: "Dune",
  creator: "Timothée Chalamet",
  year: 2021,
  medium: "movie",
  pages: null,
  episodes: null,
  runtimeMinutes: 155,
  genres: ["Sci-Fi"],
  cover: "https://m.media-amazon.com/a.jpg",
  ...over,
});

describe("list details", () => {
  it("fills in only a match with the same title", () => {
    const list = [found({ title: "Dune: Part Two" }), found({ title: "Dune", sourceId: "imdb:tt2" })];
    expect(exactMatch(list, "dune")?.sourceId).toBe("imdb:tt2");
    expect(exactMatch(list, "dune 3")).toBeNull();
    expect(exactMatch([found({ title: "Spider-Man: No Way Home" })], "spiderman no way home")).not.toBeNull();
  });

  it("puts a book's author and pages where the list reads them", () => {
    const meta = metaFrom(
      found({ medium: "book", creator: "Frank Herbert", pages: 608, sourceId: "openlibrary:/works/OL1W" }),
      { pagesRead: 40 },
    );
    expect(meta).toMatchObject({ author: "Frank Herbert", pagesTotal: 608, pagesRead: 40, year: 2021 });
    expect(meta.creator).toBeUndefined();
    // Pages already entered are kept.
    expect(metaFrom(found({ medium: "book", pages: 608 }), { pagesTotal: 500 }).pagesTotal).toBe(500);
  });

  it("describes films and series in a line", () => {
    expect(detailLine(metaFrom(found({}), {}))).toBe("2021 · Sci-Fi · 2 h 35 min");
    expect(detailLine({ year: 2009, medium: "anime", episodes: 64, runtimeMinutes: 24 })).toBe("2009 · 64 episodes");
  });
});
