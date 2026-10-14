import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useLyrics } from "./data";
import { currentLine, parseLrc } from "./logic";
import type { PlayItem } from "./spotify";

/** Lines light up this much early, so they arrive with the voice. */
const LEAD_MS = 250;
/** After scrolling by hand, the lyrics stop following the song for a while. */
const HOLD_MS = 4000;

/**
 * The song's lyrics, always on screen: timed lyrics follow the song (tap a
 * line to jump there), plain ones scroll by hand.
 */
export function Lyrics({ item, position, onSeek, className }: { item: PlayItem | null; position: () => number; onSeek: (ms: number) => void; className?: string }) {
  const { data, isLoading, isError } = useLyrics(item);
  const lines = useMemo(() => (data?.synced ? parseLrc(data.synced) : []), [data]);
  const [index, setIndex] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const heldUntil = useRef(0);
  const auto = useRef(false);
  /** Where a press started, so a swipe across the lyrics is not a tap on a line. */
  const press = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!lines.length) return;
    const tick = () => setIndex(currentLine(lines, position() + LEAD_MS));
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [lines, position]);

  useEffect(() => {
    const el = box.current;
    const line = el?.querySelector<HTMLElement>(`[data-line="${Math.max(index, 0)}"]`);
    if (!el || !line || Date.now() < heldUntil.current) return;
    auto.current = true;
    el.scrollTo({ top: line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2, behavior: "smooth" });
    const done = setTimeout(() => (auto.current = false), 700);
    return () => clearTimeout(done);
  }, [index]);

  useEffect(() => {
    box.current?.scrollTo({ top: 0 });
    heldUntil.current = 0;
  }, [item?.id]);

  const message = !item
    ? null
    : item.kind === "episode"
      ? "No lyrics for podcasts"
      : isLoading
        ? "Finding lyrics…"
        : isError
          ? "Lyrics could not be loaded"
          : data?.instrumental
            ? "Instrumental"
            : !data?.synced && !data?.plain
              ? "No lyrics found for this song"
              : null;

  return (
    <div
      ref={box}
      onPointerDown={(e) => (press.current = { x: e.clientX, y: e.clientY })}
      onScroll={() => {
        if (!auto.current) heldUntil.current = Date.now() + HOLD_MS;
      }}
      className={cn(
        "relative overflow-y-auto overscroll-contain [mask-image:linear-gradient(transparent,#000_14%,#000_86%,transparent)] [scrollbar-width:none]",
        className,
      )}
    >
      {message ? (
        <p className="grid h-full min-h-24 place-items-center text-center text-[15px] opacity-60">{message}</p>
      ) : lines.length ? (
        <div className="py-[40%]">
          {lines.map((l, i) => (
            <button
              key={`${l.at}-${i}`}
              type="button"
              data-line={i}
              onClick={(e) => {
                const p = press.current;
                if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 12) return;
                onSeek(l.at);
              }}
              className={cn(
                "block w-full py-1.5 [text-align:inherit] text-[19px] font-semibold leading-snug tracking-tight transition-opacity duration-300 md:text-[22px]",
                i === index ? "opacity-100" : i < index ? "opacity-35" : "opacity-50 hover:opacity-80",
              )}
            >
              {l.text || "♪"}
            </button>
          ))}
        </div>
      ) : (
        <p className="whitespace-pre-wrap py-6 text-[17px] font-medium leading-relaxed opacity-85">{data?.plain}</p>
      )}
    </div>
  );
}
