import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FilmSlate, MagnifyingGlass } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import type { Task, TaskMeta } from "@/core/db/schema";
import { ipc, type MediaFound } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { detailLine, metaFrom } from "./details";

function Cover({ src, book, className }: { src?: string | null; book: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  const Icon = book ? BookOpen : FilmSlate;
  return (
    <span
      className={cn(
        "bg-surface-muted text-muted-foreground grid shrink-0 place-items-center overflow-hidden rounded-md",
        className,
      )}
    >
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <Icon size={18} />
      )}
    </span>
  );
}

/** A list item's cover, for rows. */
export function ItemCover({ task, className }: { task: Task; className?: string }) {
  return <Cover src={task.meta.cover} book={task.list === "read"} className={className} />;
}

/**
 * The details of a book or title: what is known, and a search to fill them
 * in from Open Library, IMDb or AniList.
 */
export function DetailsFinder({
  list,
  title,
  meta,
  onPick,
}: {
  list: "read" | "watch";
  title: string;
  meta: TaskMeta;
  onPick: (meta: TaskMeta, title: string) => void;
}) {
  const [searching, setSearching] = useState(!meta.sourceId);
  const query = title.trim();
  const results = useQuery({
    queryKey: ["media-search", list, query],
    queryFn: () => ipc.mediaSearch(list, query),
    enabled: searching && query.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const book = list === "read";

  if (!searching) {
    return (
      <div className="border-border bg-surface-muted/40 flex items-center gap-3 rounded-xl border p-2.5">
        <Cover src={meta.cover} book={book} className="h-16 w-11" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{book ? meta.author : meta.creator}</p>
          <p className="text-muted-foreground truncate text-[12px]">{detailLine(meta)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSearching(true)}>
          Change
        </Button>
      </div>
    );
  }

  function pick(found: MediaFound) {
    onPick(metaFrom(found, meta), found.title);
    setSearching(false);
  }

  return (
    <div className="grid gap-1.5">
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        <MagnifyingGlass size={14} />
        {book ? "Which book?" : "Which one?"}
      </span>
      {query.length < 2 ? (
        <p className="text-muted-foreground text-[13px]">Type a title to look it up.</p>
      ) : results.isLoading ? (
        <>
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-14 rounded-xl" />
        </>
      ) : results.error ? (
        <p className="text-muted-foreground text-[13px]">
          Couldn't look it up. Check the connection, or fill in the details below.
        </p>
      ) : results.data?.length ? (
        <ul className="grid max-h-64 gap-1 overflow-y-auto">
          {results.data.map((f) => (
            <li key={f.sourceId}>
              <button
                type="button"
                onClick={() => pick(f)}
                className={cn(
                  "hover:bg-surface-muted flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors",
                  f.sourceId === meta.sourceId && "bg-surface-muted",
                )}
              >
                <Cover src={f.cover} book={book} className="h-12 w-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{f.title}</span>
                  <span className="text-muted-foreground block truncate text-[12px]">
                    {[
                      f.year,
                      book ? null : f.medium === "show" ? "Series" : f.medium === "anime" ? "Anime" : "Film",
                      f.creator,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">Nothing found. Fill in the details below.</p>
      )}
      {meta.sourceId ? (
        <Button variant="ghost" size="sm" className="justify-self-start" onClick={() => setSearching(false)}>
          Keep current details
        </Button>
      ) : null}
    </div>
  );
}
