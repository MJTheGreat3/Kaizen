import type { TaskMeta } from "@/core/db/schema";
import type { MediaFound } from "@/lib/ipc";

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** The match to fill in by itself: only one whose title is the same as typed. */
export function exactMatch(found: MediaFound[], title: string): MediaFound | null {
  const want = squash(title);
  return found.find((f) => squash(f.title) === want) ?? null;
}

/** Details from a match, keeping what the item already has where the match is silent. */
export function metaFrom(found: MediaFound, meta: TaskMeta): TaskMeta {
  const book = found.medium === "book";
  return {
    ...meta,
    sourceId: found.sourceId,
    year: found.year ?? meta.year,
    genres: found.genres.length ? found.genres : meta.genres,
    cover: found.cover ?? meta.cover,
    ...(book
      ? { author: found.creator ?? meta.author, pagesTotal: meta.pagesTotal ?? found.pages ?? undefined }
      : {
          creator: found.creator ?? meta.creator,
          medium: found.medium,
          episodes: found.episodes ?? meta.episodes,
          runtimeMinutes: found.runtimeMinutes ?? meta.runtimeMinutes,
        }),
  };
}

/** A short line such as "2021 · Sci-Fi · 2 h 35 min" or "2009 · 64 episodes". */
export function detailLine(meta: TaskMeta): string {
  const runtime = meta.runtimeMinutes
    ? meta.runtimeMinutes >= 60 && meta.medium === "movie"
      ? `${Math.floor(meta.runtimeMinutes / 60)} h ${meta.runtimeMinutes % 60} min`
      : `${meta.runtimeMinutes} min`
    : null;
  return [meta.year, meta.genres?.[0], meta.episodes && meta.medium !== "movie" ? `${meta.episodes} episodes` : runtime]
    .filter(Boolean)
    .join(" · ");
}
