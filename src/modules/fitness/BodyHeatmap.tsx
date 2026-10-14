import { useEffect, useMemo, useRef, useState } from "react";

import type { Exercise, Workout, WorkoutSet } from "@/core/db/schema";
import { addDaysKey, todayKey, type DateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { weekStart } from "@/modules/activity/logic";
import { REGIONS, regionsByDay, type RegionId } from "./logic";

/** Smallest cell; cells grow to fill the width once a year fits. */
const MIN_CELL = 11;
const GAP = 3;
const LABELS = 22;

const regionInfo = (id: RegionId) => REGIONS.find((r) => r.id === id)!;

/**
 * Gym days, coloured by the body region trained: one colour for one
 * region, split in two for the two most trained. A legend filters to one
 * region; hovering or tapping a day lists everything trained.
 */
export function BodyHeatmap({ workouts, sets, exercises }: { workouts: Workout[]; sets: WorkoutSet[]; exercises: Map<string, Exercise> }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
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
  const weeks = Math.max(8, Math.min(53, Math.floor((width - LABELS + GAP) / (MIN_CELL + GAP))));
  const cell = Math.max(MIN_CELL, Math.min(18, Math.floor((width - LABELS + GAP) / weeks) - GAP));
  const first = addDaysKey(weekStart(today), -7 * (weeks - 1));
  const totals = useMemo(() => {
    const out = new Map<RegionId, number>();
    for (const [d, regions] of days) if (d >= first) for (const [r, n] of regions) out.set(r, (out.get(r) ?? 0) + n);
    return out;
  }, [days, first]);
  const columns = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDaysKey(first, w * 7 + d)));
  const shown = hover ? days.get(hover) : null;

  const ranked = (regions: Map<RegionId, number>) => [...regions].sort((a, b) => b[1] - a[1]);

  return (
    <div ref={box} className="grid gap-3">
      <div className="relative overflow-hidden" onPointerLeave={() => setHover(null)}>
        <div className="flex gap-[3px]">
          <div className="grid shrink-0 gap-[3px] pt-[18px] text-[10px] text-muted-foreground" style={{ width: LABELS - GAP }}>
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
                <span className="h-[15px] overflow-visible whitespace-nowrap text-[10px] text-muted-foreground">{showMonth ? month.toLocaleDateString([], { month: "short" }) : ""}</span>
                {col.map((d) => {
                  const regions = days.get(d);
                  const top = regions ? ranked(regions) : [];
                  const dim = focus && !regions?.has(focus);
                  const colors = focus && regions?.has(focus) ? [regionInfo(focus).color] : top.slice(0, 2).map(([r]) => regionInfo(r).color);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={d > today}
                      onPointerEnter={() => setHover(d)}
                      onClick={() => setHover(d)}
                      aria-label={`${d}: ${top.length ? top.map(([r, n]) => `${regionInfo(r).name} ${n} sets`).join(", ") : "no workout"}`}
                      className={cn("relative overflow-hidden rounded-[3px] transition-opacity", d > today ? "opacity-0" : "", hover === d && "ring-2 ring-foreground/60")}
                      style={{
                        width: cell,
                        height: cell,
                        background: colors.length ? (colors.length === 2 ? `linear-gradient(90deg, ${colors[0]} 50%, ${colors[1]} 50%)` : colors[0]) : "var(--surface-muted)",
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
          <div className="pointer-events-none absolute right-0 top-0 z-10 grid min-w-44 gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-float">
            <p className="font-medium">{new Date(`${hover}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</p>
            {names.get(hover)?.length ? <p className="text-muted-foreground">{names.get(hover)!.join(", ")}</p> : null}
            {ranked(shown).map(([r, n]) => (
              <p key={r} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[3px]" style={{ background: regionInfo(r).color }} />
                  {regionInfo(r).name}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {n} {n === 1 ? "set" : "sets"}
                </span>
              </p>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Body regions">
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
              <span className="tabular-nums text-muted-foreground">{totals.get(r.id) ?? 0}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[12px] text-muted-foreground">Working sets per region over these weeks. A split square had two regions; tap a region to see only its days.</p>
    </div>
  );
}
