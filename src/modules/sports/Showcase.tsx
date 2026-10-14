import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { CaretLeft, CaretRight, Plus, Warning } from "@phosphor-icons/react";

import type { SportFollow, SportStat } from "@/core/db/schema";
import { cn } from "@/lib/utils";
import { MAX_FAVOURITES, sportName } from "./logic";
import { Avatar } from "./parts";

function PlayerCard({ player, stat, hue, onOpen }: { player: SportFollow; stat: SportStat | undefined; hue: string; onOpen: () => void }) {
  const s = stat?.data;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-card
      className="group relative flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border bg-surface p-4 text-left shadow-soft transition-transform active:scale-[0.99] sm:w-[280px]"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-28"
        style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${hue} 18%, transparent), transparent)` }}
      />
      <span className="relative flex items-start gap-3">
        <Avatar src={s?.image ?? player.image} name={player.name} className="size-16 text-[18px] ring-2 ring-surface" />
        <span className="grid min-w-0 flex-1 gap-0.5 pt-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{sportName(player.sport)}</span>
          <span className="truncate text-[16px] font-semibold leading-tight">{player.name}</span>
          <span className="truncate text-[12px] text-muted-foreground">{s ? [s.team, s.position].filter(Boolean).join(" · ") : (player.subtitle ?? "")}</span>
        </span>
      </span>
      <span className="relative mt-4 text-[12px] font-medium text-muted-foreground">{s ? s.seasonLabel : player.error ? "" : "Fetching stats…"}</span>
      {s?.highlights.length ? (
        <span className="relative mt-1.5 grid grid-cols-2 gap-x-3 gap-y-2">
          {s.highlights.slice(0, 4).map((h) => (
            <span key={h.label} className="grid">
              <span className="text-[20px] font-semibold leading-none tracking-tight tabular-nums">{h.value}</span>
              <span className="mt-0.5 truncate text-[11px] text-muted-foreground">{h.label}</span>
            </span>
          ))}
        </span>
      ) : player.error ? (
        <span className="relative mt-1.5 flex items-center gap-1 text-[12px] text-danger" title={player.error}>
          <Warning size={12} className="shrink-0" />
          <span className="line-clamp-2">{player.error}</span>
        </span>
      ) : (
        <span className="relative mt-1.5 grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="h-8 animate-pulse rounded-md bg-surface-muted" />
          ))}
        </span>
      )}
      <span className="relative mt-4 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">Season and career stats →</span>
    </button>
  );
}

/** Favourite players in a swipeable row; each card opens the player page. */
export function Showcase({ players, stats, hue, onAdd }: { players: SportFollow[]; stats: Map<string, SportStat>; hue: string; onAdd: () => void }) {
  const navigate = useNavigate();
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [edges, setEdges] = useState({ start: true, end: false });
  const count = players.length + (players.length < MAX_FAVOURITES ? 1 : 0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () => {
      const cards = [...el.querySelectorAll<HTMLElement>("[data-card]")];
      const left = el.scrollLeft;
      let best = 0;
      cards.forEach((c, i) => {
        if (Math.abs(c.offsetLeft - el.offsetLeft - left) < Math.abs(cards[best]!.offsetLeft - el.offsetLeft - left)) best = i;
      });
      setActive(best);
      setEdges({ start: left <= 2, end: left + el.clientWidth >= el.scrollWidth - 2 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [count]);

  const go = (i: number) => {
    const el = track.current;
    const card = el?.querySelectorAll<HTMLElement>("[data-card]")[i];
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: "smooth" });
  };

  return (
    <div className="grid min-w-0 gap-3">
      <div className="relative min-w-0">
        <div ref={track} className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none] md:mx-0 md:scroll-px-0 md:px-0 [&::-webkit-scrollbar]:hidden">
          {players.map((p) => (
            <PlayerCard key={p.id} player={p} stat={stats.get(p.id)} hue={hue} onOpen={() => void navigate({ to: "/sports/players", search: { p: p.id } })} />
          ))}
          {players.length < MAX_FAVOURITES ? (
            <button
              type="button"
              data-card
              onClick={onAdd}
              className="flex min-h-56 w-[60vw] max-w-[220px] shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border text-[14px] font-medium text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground sm:w-[200px]"
            >
              <Plus size={20} />
              Add a favourite
              <span className="text-[12px] font-normal">
                {players.length} of {MAX_FAVOURITES}
              </span>
            </button>
          ) : null}
        </div>
        {!edges.start ? (
          <button
            type="button"
            aria-label="Previous player"
            onClick={() => go(Math.max(0, active - 1))}
            className="absolute left-0 top-1/2 hidden size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border bg-surface shadow-soft hover:bg-surface-muted md:grid"
          >
            <CaretLeft size={16} />
          </button>
        ) : null}
        {!edges.end ? (
          <button
            type="button"
            aria-label="Next player"
            onClick={() => go(Math.min(count - 1, active + 1))}
            className="absolute right-0 top-1/2 hidden size-9 -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border border-border bg-surface shadow-soft hover:bg-surface-muted md:grid"
          >
            <CaretRight size={16} />
          </button>
        ) : null}
      </div>
      {count > 1 ? (
        <div className="flex justify-center gap-1.5" role="tablist" aria-label="Showcase position">
          {Array.from({ length: count }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={i < players.length ? players[i]!.name : "Add a favourite"}
              onClick={() => go(i)}
              className={cn("h-1.5 rounded-full transition-all", i === active ? "w-5 bg-foreground/70" : "w-1.5 bg-foreground/20")}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
