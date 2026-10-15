import { useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Pause, Play, SkipForward } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { pathOf } from "@/modules/registry";
import { useConnected, useControl, useHistorySync, usePalette, usePlayback, useRestoreEq, playWithWake } from "./data";
import { imageFor, positionNow, spotify } from "./spotify";

/**
 * What is playing, from anywhere in the app: in the sidebar on the laptop
 * and above the bottom bar on the phone (hidden on the Music page). Also
 * keeps the listening history filled and the phone's equaliser on.
 */
export function MiniPlayer({ variant }: { variant: "sidebar" | "bar" }) {
  const connected = useConnected();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { data: p } = usePlayback(connected ? 8000 : 0);
  const palette = usePalette(p?.item?.images);
  const control = useControl();
  const shown = connected && !!p?.item && !path.startsWith(pathOf("music"));
  // Pages leave room for the bar above the bottom navigation.
  useEffect(() => {
    if (variant !== "bar") return;
    document.documentElement.toggleAttribute("data-mini-player", shown);
    return () => document.documentElement.removeAttribute("data-mini-player");
  }, [variant, shown]);
  if (!shown || !p?.item) return null;
  const item = p.item;
  const progress = item.durationMs ? positionNow(p) / item.durationMs : 0;
  const toggle = () =>
    control.mutate({
      run: () => (p.isPlaying ? spotify.pause() : playWithWake()),
      optimistic: (x) => ({ ...x, isPlaying: !x.isPlaying }),
    });

  return (
    <div
      className={cn(
        "relative flex items-center gap-2.5 overflow-hidden",
        variant === "sidebar"
          ? "shadow-soft mb-3 rounded-xl p-2"
          : "shadow-float fixed inset-x-2 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 rounded-2xl p-2 md:hidden",
      )}
      style={{ background: palette.bg, color: palette.text }}
    >
      <Link to={pathOf("music")} className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-black/20">
          {imageFor(item.images, 64) ? (
            <img src={imageFor(item.images, 64)!} alt="" className="size-full object-cover" />
          ) : null}
        </span>
        <span className="grid min-w-0">
          <span className="truncate text-[13px] font-semibold">{item.name}</span>
          <span className="truncate text-[12px] opacity-70">{item.artists.map((a) => a.name).join(", ")}</span>
        </span>
      </Link>
      <button
        type="button"
        aria-label={p.isPlaying ? "Pause" : "Play"}
        onClick={toggle}
        className="grid size-9 shrink-0 place-items-center rounded-full active:scale-90"
      >
        {p.isPlaying ? <Pause size={20} weight="fill" /> : <Play size={20} weight="fill" />}
      </button>
      {variant === "bar" ? (
        <button
          type="button"
          aria-label="Next"
          onClick={() => control.mutate({ run: spotify.next })}
          className="grid size-9 shrink-0 place-items-center rounded-full active:scale-90"
        >
          <SkipForward size={20} weight="fill" />
        </button>
      ) : null}
      <span
        className="absolute inset-x-0 bottom-0 h-[2px] origin-left"
        style={{ background: palette.accent, transform: `scaleX(${progress})` }}
      />
    </div>
  );
}

/** Background music work for the whole app; renders nothing. */
export function MusicHost() {
  const connected = useConnected();
  useHistorySync(connected);
  useRestoreEq();
  return null;
}
