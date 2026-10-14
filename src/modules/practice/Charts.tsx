import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

import { Segmented } from "@/components/ui/controls";
import type { CpPlatform, CpProblem, CpRating } from "@/core/db/schema";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { difficultyBuckets, PLATFORMS, platformOf, tagLabel, tagStats, weakTags } from "./logic";

const fmtDate = (ms: number, year = true) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

// ---------------------------------------------------------------------------
// Rating history
// ---------------------------------------------------------------------------

type Range = "1y" | "all";

/** Rating over time, one line per platform, with a crosshair tooltip. */
export function RatingChart({ ratings }: { ratings: CpRating[] }) {
  const [range, setRange] = useState<Range>("all");
  const [hidden, setHidden] = useState<CpPlatform[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());
  const [width, setWidth] = useState(640);
  const hasData = ratings.length > 0;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasData]);

  const present = PLATFORMS.filter((p) => ratings.some((r) => r.platform === p.id));
  const view = useMemo(() => {
    const from = range === "1y" ? now - 365 * 86_400_000 : -Infinity;
    const shown = ratings.filter((r) => r.at >= from && !hidden.includes(r.platform));
    if (!shown.length) return null;
    const t0 = Math.min(...shown.map((r) => r.at));
    const t1 = Math.max(now, ...shown.map((r) => r.at));
    const lo = Math.floor(Math.min(...shown.map((r) => r.rating)) / 100) * 100 - 50;
    const hi = Math.ceil(Math.max(...shown.map((r) => r.rating)) / 100) * 100 + 50;
    const series = PLATFORMS.filter((p) => shown.some((r) => r.platform === p.id)).map((p) => ({
      p,
      points: shown.filter((r) => r.platform === p.id),
    }));
    const step = (hi - lo) / 4 > 300 ? 500 : (hi - lo) / 4 > 150 ? 200 : 100;
    const ticks: number[] = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
    return { t0, t1, lo, hi, series, ticks };
  }, [ratings, range, hidden, now]);

  // Drawn at the container's real width so text stays the same size on phones.
  const W = Math.max(280, width);
  const H = W < 480 ? 190 : 220;
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  if (!present.length) return <p className="py-10 text-center text-[14px] text-muted-foreground">Ratings appear after your first rated contest.</p>;

  const x = (t: number) => (view ? padL + ((t - view.t0) / Math.max(1, view.t1 - view.t0)) * (W - padL - padR) : 0);
  const y = (v: number) => (view ? padT + (1 - (v - view.lo) / (view.hi - view.lo)) * (H - padT - padB) : 0);

  // Nearest contest to the pointer, per platform.
  const hovered =
    view && hover !== null
      ? view.series
          .map(({ p, points }) => {
            const best = points.reduce((b, r) => (Math.abs(x(r.at) - hover) < Math.abs(x(b.at) - hover) ? r : b), points[0]);
            return { p, r: best };
          })
          .filter(({ r }) => Math.abs(x(r.at) - hover) < 40)
      : [];

  function onMove(e: React.PointerEvent) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setHover(((e.clientX - rect.left) / rect.width) * W);
  }

  return (
    <div ref={box} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Platforms">
          {present.map((p) => {
            const on = !hidden.includes(p.id);
            const last = ratings.filter((r) => r.platform === p.id).at(-1);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setHidden((h) => (on ? [...h, p.id] : h.filter((x) => x !== p.id)))}
                className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors", on ? "border-border bg-surface" : "border-transparent text-muted-foreground opacity-60")}
              >
                <span className="h-0.5 w-3 rounded-full" style={{ background: p.color }} />
                {p.name}
                {last ? <span className="tabular-nums text-muted-foreground">{Math.round(last.rating)}</span> : null}
              </button>
            );
          })}
        </div>
        <Segmented
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: "1y", label: "Year" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      {view ? (
        <div className="relative" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label="Rating history">
            {view.ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                  {t}
                </text>
              </g>
            ))}
            <text x={padL} y={H - 6} fontSize={10} fill="var(--muted-foreground)">
              {fmtDate(view.t0)}
            </text>
            <text x={W - padR} y={H - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
              Today
            </text>
            {view.series.map(({ p, points }) => {
              const d = points.map((r, i) => `${i ? "L" : "M"} ${x(r.at)} ${y(r.rating)}`).join(" ");
              return (
                <motion.path
                  key={p.id}
                  d={d}
                  fill="none"
                  stroke={p.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, ease }}
                />
              );
            })}
            {hover !== null && hovered.length ? (
              <>
                <line x1={x(hovered[0].r.at)} x2={x(hovered[0].r.at)} y1={padT} y2={H - padB} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
                {hovered.map(({ p, r }) => (
                  <circle key={p.id} cx={x(r.at)} cy={y(r.rating)} r={4.5} fill={p.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
              </>
            ) : null}
          </svg>
          {hover !== null && hovered.length ? (
            <div
              className="pointer-events-none absolute top-1 z-10 grid gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-float"
              // Kept inside the chart: the SVG is drawn at its real width, so x is in pixels.
              style={{ left: Math.min(W - 200, Math.max(0, x(hovered[0].r.at) - 100)), width: 200 }}
            >
              {hovered.map(({ p, r }) => (
                <div key={p.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="size-2 rounded-full" style={{ background: p.color }} />
                      {Math.round(r.rating)}
                    </span>
                    <span className="text-muted-foreground">{fmtDate(r.at)}</span>
                  </div>
                  <p className="truncate text-muted-foreground">
                    {r.contest}
                    {r.rank ? ` · rank ${r.rank}` : ""}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="py-10 text-center text-[14px] text-muted-foreground">No rated contests in this range.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

export function DifficultyChart({ problems, platforms }: { problems: CpProblem[]; platforms: CpPlatform[] }) {
  const options = platforms.filter((id) => difficultyBuckets(id, problems).some((b) => b.count));
  const [chosen, setChosen] = useState<CpPlatform | null>(null);
  const platform = chosen && options.includes(chosen) ? chosen : options[0];
  const [hover, setHover] = useState<number | null>(null);
  if (!platform) return <p className="py-8 text-center text-[14px] text-muted-foreground">Solved problems by difficulty appear here.</p>;
  const buckets = difficultyBuckets(platform, problems);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="grid gap-3">
      {options.length > 1 ? (
        <Segmented label="Platform" value={platform} onChange={setChosen} options={options.map((id) => ({ value: id, label: platformOf(id)!.name }))} />
      ) : null}
      <div className="flex h-40 items-end gap-[2px]" onPointerLeave={() => setHover(null)}>
        {buckets.map((b, i) => (
          <div key={b.label} className="relative flex h-full flex-1 flex-col justify-end" onPointerEnter={() => setHover(i)}>
            {hover === i ? (
              <span className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[12px] shadow-float">
                {b.label}
                {platform === "leetcode" ? "" : "+"}: <b className="tabular-nums">{b.count}</b>
              </span>
            ) : null}
            <motion.div
              className="rounded-t-[4px]"
              style={{ background: b.color, opacity: hover === null || hover === i ? 1 : 0.55 }}
              initial={{ height: 0 }}
              animate={{ height: `${(b.count / max) * 100}%` }}
              transition={{ duration: 0.5, ease, delay: i * 0.02 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] text-[10px] text-muted-foreground">
        {buckets.map((b, i) => (
          <span key={b.label} className="flex-1 truncate text-center">
            {buckets.length > 10 && i % 2 ? "" : b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export function TopicsChart({ problems }: { problems: CpProblem[] }) {
  const stats = useMemo(() => tagStats(problems), [problems]);
  const weak = useMemo(() => weakTags(stats), [stats]);
  const [all, setAll] = useState(false);
  const top = stats.slice(0, all ? 30 : 8);
  if (!stats.length) return <p className="py-8 text-center text-[14px] text-muted-foreground">Topics appear once problems with tags are solved.</p>;
  const max = Math.max(1, ...top.map((s) => s.attempted));
  return (
    <div className="grid gap-4">
      <ul className="grid gap-2">
        {top.map((s) => (
          <li key={s.tag} className="grid grid-cols-[minmax(0,8.5rem)_1fr_auto] items-center gap-3 text-[13px]" title={`${s.solved} solved of ${s.attempted} tried`}>
            <span className="truncate">{tagLabel(s.tag)}</span>
            <span className="relative h-2.5 overflow-hidden rounded-full bg-surface-muted">
              {/* Tried, with the solved part on top. */}
              <span className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/25" style={{ width: `${(s.attempted / max) * 100}%` }} />
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full bg-[var(--cp-atcoder)]"
                initial={{ width: 0 }}
                animate={{ width: `${(s.solved / max) * 100}%` }}
                transition={{ duration: 0.5, ease }}
              />
            </span>
            <span className="w-16 text-right tabular-nums text-muted-foreground">
              {s.solved}
              <span className="opacity-60"> / {s.attempted}</span>
            </span>
          </li>
        ))}
      </ul>
      {stats.length > 8 ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="justify-self-start text-[13px] font-medium text-muted-foreground hover:text-foreground">
          {all ? "Show fewer" : `All ${Math.min(stats.length, 30)} topics`}
        </button>
      ) : null}
      {weak.length ? (
        <div className="grid gap-2 border-t border-border/70 pt-3">
          <p className="text-[13px] font-medium">Weak spots</p>
          <div className="flex flex-wrap gap-1.5">
            {weak.map((s) => (
              <span key={s.tag} className="rounded-full border border-border px-2.5 py-1 text-[12px]">
                {tagLabel(s.tag)} <span className="tabular-nums text-muted-foreground">{Math.round(s.rate * 100)}%</span>
              </span>
            ))}
          </div>
          <p className="text-[12px] text-muted-foreground">Topics where you solve noticeably fewer of the problems you try.</p>
        </div>
      ) : null}
    </div>
  );
}
