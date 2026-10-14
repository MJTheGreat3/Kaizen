import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";

import { Segmented } from "@/components/ui/controls";
import type { CpPlatform, CpProblem, CpRating } from "@/core/db/schema";
import type { DateKey } from "@/lib/dates";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { difficultyBuckets, PLATFORMS, platformOf, weeklyContributions } from "./logic";

const fmtDate = (ms: number, year = true) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) });

// ---------------------------------------------------------------------------
// Rating history
// ---------------------------------------------------------------------------

type Range = "1y" | "all";

/** GitHub's colour on the heatmap. */
const GITHUB = "#5a6ad0";

const keyOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const msOf = (key: DateKey) => new Date(`${key}T12:00:00`).getTime();

/**
 * Ratings over time, one line per site, and GitHub contributions per week
 * in a panel below on the same time axis (they have their own scale, so
 * they get their own panel rather than a second axis). One crosshair and
 * tooltip covers both.
 */
export function ProgressChart({ ratings, contributions }: { ratings: CpRating[]; contributions: Map<DateKey, number> }) {
  const [range, setRange] = useState<Range>("1y");
  const [hidden, setHidden] = useState<string[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [now] = useState(() => Date.now());
  const [width, setWidth] = useState(640);
  const hasGithub = [...contributions.values()].some((n) => n > 0);
  const hasData = ratings.length > 0 || hasGithub;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasData]);

  const present = PLATFORMS.filter((p) => ratings.some((r) => r.platform === p.id));
  const showGithub = hasGithub && !hidden.includes("github");
  const view = useMemo(() => {
    const from = range === "1y" ? now - 365 * 86_400_000 : -Infinity;
    const shown = ratings.filter((r) => r.at >= from && !hidden.includes(r.platform));
    const days = [...contributions].filter(([d, n]) => n > 0 && msOf(d) >= from).map(([d]) => msOf(d));
    const starts = [...shown.map((r) => r.at), ...(showGithub ? days : [])];
    if (!starts.length) return null;
    const t0 = range === "1y" ? Math.max(from, Math.min(...starts)) : Math.min(...starts);
    const t1 = now;
    const series = PLATFORMS.filter((p) => shown.some((r) => r.platform === p.id)).map((p) => ({
      p,
      points: shown.filter((r) => r.platform === p.id),
    }));
    let rating = null;
    if (shown.length) {
      const lo = Math.floor(Math.min(...shown.map((r) => r.rating)) / 100) * 100 - 50;
      const hi = Math.ceil(Math.max(...shown.map((r) => r.rating)) / 100) * 100 + 50;
      const step = (hi - lo) / 4 > 300 ? 500 : (hi - lo) / 4 > 150 ? 200 : 100;
      const ticks: number[] = [];
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
      rating = { lo, hi, ticks };
    }
    const weeks = showGithub ? weeklyContributions(contributions, keyOf(t0), keyOf(t1)).map((w) => ({ ...w, at: msOf(w.week) + 3.5 * 86_400_000 })) : [];
    const most = Math.max(1, ...weeks.map((w) => w.count));
    return { t0, t1, series, rating, weeks, most };
  }, [ratings, contributions, range, hidden, now, showGithub]);

  // Drawn at the container's real width so text stays the same size on phones.
  const W = Math.max(280, width);
  const padL = 40;
  const padR = 12;
  const padT = 10;
  const axis = 22;
  const gap = 14;
  const H1 = view?.rating ? (W < 480 ? 170 : 200) : 0;
  const H2 = view?.weeks.length ? (view.rating ? 72 : 150) : 0;
  const H = padT + H1 + (H1 && H2 ? gap : 0) + H2 + axis;
  const top2 = padT + H1 + (H1 && H2 ? gap : 0);
  if (!hasData) return <p className="py-10 text-center text-[14px] text-muted-foreground">Ratings appear after your first rated contest, contributions once GitHub is connected.</p>;

  const x = (t: number) => (view ? padL + ((t - view.t0) / Math.max(1, view.t1 - view.t0)) * (W - padL - padR) : 0);
  const y = (v: number) => (view?.rating ? padT + (1 - (v - view.rating.lo) / (view.rating.hi - view.rating.lo)) * H1 : 0);
  const y2 = (n: number) => (view ? top2 + (1 - n / view.most) * (H2 - 4) + 4 : 0);

  // Nearest contest per site, and the week under the pointer.
  const hovered =
    view && hover !== null
      ? view.series
          .map(({ p, points }) => {
            const best = points.reduce((b, r) => (Math.abs(x(r.at) - hover) < Math.abs(x(b.at) - hover) ? r : b), points[0]);
            return { p, r: best };
          })
          .filter(({ r }) => Math.abs(x(r.at) - hover) < 40)
      : [];
  const week = view && hover !== null && view.weeks.length ? view.weeks.reduce((b, w) => (Math.abs(x(w.at) - hover) < Math.abs(x(b.at) - hover) ? w : b), view.weeks[0]!) : null;
  const cross = hovered[0]?.r.at ?? week?.at ?? null;

  function onMove(e: React.PointerEvent) {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    setHover(((e.clientX - rect.left) / rect.width) * W);
  }

  const chip = (id: string, label: string, color: string, value: string | null) => {
    const on = !hidden.includes(id);
    return (
      <button
        key={id}
        type="button"
        aria-pressed={on}
        onClick={() => setHidden((h) => (on ? [...h, id] : h.filter((x) => x !== id)))}
        className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors", on ? "border-border bg-surface" : "border-transparent text-muted-foreground opacity-60")}
      >
        <span className="h-0.5 w-3 rounded-full" style={{ background: color }} />
        {label}
        {value ? <span className="tabular-nums text-muted-foreground">{value}</span> : null}
      </button>
    );
  };
  const yearTotal = [...contributions].filter(([d]) => msOf(d) >= now - 365 * 86_400_000).reduce((n, [, c]) => n + c, 0);

  return (
    <div ref={box} className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Series">
          {present.map((p) => {
            const last = ratings.filter((r) => r.platform === p.id).at(-1);
            return chip(p.id, p.name, p.color, last ? String(Math.round(last.rating)) : null);
          })}
          {hasGithub ? chip("github", "GitHub", GITHUB, `${yearTotal.toLocaleString()} this year`) : null}
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
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label="Ratings and GitHub contributions over time">
            {view.rating
              ? view.rating.ticks.map((t) => (
                  <g key={t}>
                    <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
                    <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                      {t}
                    </text>
                  </g>
                ))
              : null}
            {view.weeks.length ? (
              <g>
                <line x1={padL} x2={W - padR} y1={top2 + H2} y2={top2 + H2} stroke="var(--border)" strokeWidth={1} />
                <line x1={padL} x2={W - padR} y1={y2(view.most)} y2={y2(view.most)} stroke="var(--border)" strokeDasharray="2 3" strokeWidth={1} />
                <text x={padL - 6} y={y2(view.most) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                  {view.most}
                </text>
                <text x={padL - 6} y={top2 + H2 + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
                  0
                </text>
                <text x={padL} y={top2 - 2} fontSize={10} fill="var(--muted-foreground)">
                  GitHub contributions a week
                </text>
                <motion.path
                  d={`${view.weeks.map((w, i) => `${i ? "L" : "M"} ${x(w.at)} ${y2(w.count)}`).join(" ")} L ${x(view.weeks.at(-1)!.at)} ${top2 + H2} L ${x(view.weeks[0]!.at)} ${top2 + H2} Z`}
                  fill={GITHUB}
                  fillOpacity={0.12}
                  stroke="none"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, ease }}
                />
                <motion.path
                  d={view.weeks.map((w, i) => `${i ? "L" : "M"} ${x(w.at)} ${y2(w.count)}`).join(" ")}
                  fill="none"
                  stroke={GITHUB}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, ease }}
                />
              </g>
            ) : null}
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
            {cross !== null ? (
              <>
                <line x1={x(cross)} x2={x(cross)} y1={padT} y2={H - axis} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
                {hovered.map(({ p, r }) => (
                  <circle key={p.id} cx={x(r.at)} cy={y(r.rating)} r={4.5} fill={p.color} stroke="var(--surface)" strokeWidth={2} />
                ))}
                {week ? <circle cx={x(week.at)} cy={y2(week.count)} r={4} fill={GITHUB} stroke="var(--surface)" strokeWidth={2} /> : null}
              </>
            ) : null}
          </svg>
          {cross !== null ? (
            <div
              className="pointer-events-none absolute top-1 z-10 grid gap-1 rounded-lg border border-border bg-surface px-3 py-2 text-[12px] shadow-float"
              // Kept inside the chart: the SVG is drawn at its real width, so x is in pixels.
              style={{ left: Math.min(W - 200, Math.max(0, x(cross) - 100)), width: 200 }}
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
              {week ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="size-2 rounded-full" style={{ background: GITHUB }} />
                    {week.count} {week.count === 1 ? "contribution" : "contributions"}
                  </span>
                  <span className="text-muted-foreground">wk of {fmtDate(msOf(week.week), false)}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="py-10 text-center text-[14px] text-muted-foreground">Nothing in this range.</p>
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
