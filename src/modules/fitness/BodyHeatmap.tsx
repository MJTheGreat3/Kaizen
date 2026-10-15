import { useEffect, useMemo, useRef, useState } from "react";

import type { Exercise, Workout, WorkoutSet } from "@/core/db/schema";
import { addDaysKey, todayKey, type DateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { weekStart } from "@/modules/activity/logic";
import { REGIONS, regionsByDay, type RegionId } from "./logic";

/** About three months of weeks. */
const WEEKS = 13;
const MIN_CELL = 11;
const MAX_CELL = 30;
const GAP = 3;
const LABELS = 22;

const regionInfo = (id: RegionId) => REGIONS.find((r) => r.id === id)!;

/** Equal vertical stripes, one per colour. */
function stripes(colors: string[]) {
  if (colors.length === 1) return colors[0];
  const w = 100 / colors.length;
  return `linear-gradient(90deg, ${colors.map((c, i) => `${c} ${i * w}% ${(i + 1) * w}%`).join(", ")})`;
}

/**
 * Gym days, coloured by the body region trained: one colour for one
 * region, split in two for the two most trained. A legend filters to one
 * region; hovering or tapping a day lists everything trained.
 */
export function BodyHeatmap({
  workouts,
  sets,
  exercises,
}: {
  workouts: Workout[];
  sets: WorkoutSet[];
  exercises: Map<string, Exercise>;
}) {
  const box = useRef<HTMLDivElement>(null);
  // Starts at the smallest squares and grows to fit: starting wide would
  // stretch the page, and the box would then measure its own overflow.
  const [width, setWidth] = useState(0);
  const [focus, setFocus] = useState<RegionId | null>(null);
  const [hover, setHover] = useState<DateKey | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const today = todayKey();
  const days = useMemo(() => regionsByDay(sets, workouts, exercises), [sets, workouts, exercises]);
  const names = useMemo(() => {
    const out = new Map<DateKey, string[]>();
    for (const w of workouts) if (w.endedAt) out.set(w.date, [...(out.get(w.date) ?? []), w.name]);
    return out;
  }, [workouts]);
  const weeks = WEEKS;
  const cell = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor((width - LABELS + GAP) / weeks) - GAP));
  const first = addDaysKey(weekStart(today), -7 * (weeks - 1));
  const totals = useMemo(() => {
    const out = new Map<RegionId, number>();
    for (const [d, regions] of days) if (d >= first) for (const [r, n] of regions) out.set(r, (out.get(r) ?? 0) + n);
    return out;
  }, [days, first]);
  const columns = Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDaysKey(first, w * 7 + d)),
  );
  const shown = hover ? days.get(hover) : null;

  const ranked = (regions: Map<RegionId, number>) => [...regions].sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:gap-8">
        <div
          ref={box}
          className="relative min-w-0 flex-1 overflow-hidden md:max-w-[480px]"
          onPointerLeave={() => setHover(null)}
        >
          <div className="flex gap-[3px]">
            <div
              className="text-muted-foreground grid shrink-0 gap-[3px] pt-[18px] text-[10px]"
              style={{ width: LABELS - GAP }}
            >
              {["M", "", "W", "", "F", "", ""].map((l, i) => (
                <span key={i} style={{ height: cell, lineHeight: `${cell}px` }}>
                  {l}
                </span>
              ))}
            </div>
            {columns.map((col, w) => {
              const month = new Date(`${col[0]}T12:00:00`);
              const showMonth = w === 0 || month.getDate() <= 7;
              return (
                <div key={col[0]} className="grid shrink-0 gap-[3px]" style={{ width: cell }}>
                  <span className="text-muted-foreground h-[15px] overflow-visible text-[10px] whitespace-nowrap">
                    {showMonth ? month.toLocaleDateString([], { month: "short" }) : ""}
                  </span>
                  {col.map((d) => {
                    const regions = days.get(d);
                    const top = regions ? ranked(regions) : [];
                    const dim = focus && !regions?.has(focus);
                    const colors =
                      focus && regions?.has(focus) ? [regionInfo(focus).color] : top.map(([r]) => regionInfo(r).color);
                    return (
                      <button
                        key={d}
                        type="button"
                        disabled={d > today}
                        onPointerEnter={() => setHover(d)}
                        onClick={() => setHover(d)}
                        aria-label={`${d}: ${top.length ? top.map(([r, n]) => `${regionInfo(r).name} ${n} sets`).join(", ") : "no workout"}`}
                        className={cn(
                          "relative overflow-hidden rounded-[3px] transition-opacity",
                          d > today ? "opacity-0" : "",
                          hover === d && "ring-foreground/60 ring-2",
                        )}
                        style={{
                          width: cell,
                          height: cell,
                          background: colors.length ? stripes(colors) : "var(--surface-muted)",
                          opacity: dim ? 0.18 : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          {hover && shown ? (
            <div className="border-border bg-surface shadow-float pointer-events-none absolute top-0 right-0 z-10 grid min-w-44 gap-1 rounded-lg border px-3 py-2 text-[12px]">
              <p className="font-medium">
                {new Date(`${hover}T12:00:00`).toLocaleDateString([], {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                })}
              </p>
              {names.get(hover)?.length ? (
                <p className="text-muted-foreground">{names.get(hover)!.join(", ")}</p>
              ) : null}
              {ranked(shown).map(([r, n]) => (
                <p key={r} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px]" style={{ background: regionInfo(r).color }} />
                    {regionInfo(r).name}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {n} {n === 1 ? "set" : "sets"}
                  </span>
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5 md:grid md:w-44 md:shrink-0" role="group" aria-label="Body regions">
          {REGIONS.filter((r) => totals.get(r.id) || r.id !== "other").map((r) => {
            const on = focus === r.id;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => setFocus(on ? null : r.id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors",
                  on ? "border-foreground/30 bg-surface-muted" : "border-border",
                  focus && !on && "opacity-60",
                )}
              >
                <span className="size-2.5 rounded-[3px]" style={{ background: r.color }} />
                {r.name}
                <span className="text-muted-foreground tabular-nums md:ml-auto">{totals.get(r.id) ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="text-muted-foreground text-[12px]">
        Working sets per region over the last three months. A striped square trained several regions, the most worked
        first; tap a region to see only its days.
      </p>
    </div>
  );
}
