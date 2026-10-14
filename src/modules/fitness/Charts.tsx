import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

function useWidth<T extends HTMLElement>(initial = 600) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });

/** Nice tick values covering lo..hi. */
function ticks(lo: number, hi: number, count = 4) {
  const raw = (hi - lo) / count || 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export interface Point {
  at: number;
  value: number;
}

/** One series over time with a crosshair and tooltip. */
export function LineChart({ points, color, format, label }: { points: Point[]; color: string; format: (v: number) => string; label: string }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="py-8 text-center text-[13px] text-muted-foreground">{points.length ? "One more entry draws the line." : "Nothing logged yet."}</p>;

  const W = Math.max(260, width);
  const H = W < 480 ? 170 : 200;
  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const t0 = points[0]!.at;
  const t1 = points.at(-1)!.at;
  const values = points.map((p) => p.value);
  const spread = Math.max(...values) - Math.min(...values) || Math.max(...values) * 0.1 || 1;
  const ys = ticks(Math.min(...values) - spread * 0.1, Math.max(...values) + spread * 0.1);
  const lo = ys[0]!;
  const hi = ys.at(-1)!;
  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo || 1)) * (H - padT - padB);
  const d = points.map((p, i) => `${i ? "L" : "M"} ${x(p.at)} ${y(p.value)}`).join(" ");
  const near = hover === null ? null : points.reduce((b, p) => (Math.abs(x(p.at) - hover) < Math.abs(x(b.at) - hover) ? p : b), points[0]!);

  return (
    <div
      ref={box}
      className="relative"
      onPointerMove={(e) => {
        const rect = box.current?.getBoundingClientRect();
        if (rect) setHover(((e.clientX - rect.left) / rect.width) * W);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label={label}>
        {ys.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
              {format(t)}
            </text>
          </g>
        ))}
        <text x={padL} y={H - 6} fontSize={10} fill="var(--muted-foreground)">
          {fmtDate(t0)}
        </text>
        <text x={W - padR} y={H - 6} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
          {fmtDate(t1)}
        </text>
        <motion.path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease }} />
        {points.length <= 40
          ? points.map((p) => <circle key={p.at} cx={x(p.at)} cy={y(p.value)} r={3} fill={color} stroke="var(--surface)" strokeWidth={2} />)
          : null}
        {near ? (
          <>
            <line x1={x(near.at)} x2={x(near.at)} y1={padT} y2={H - padB} stroke="var(--muted-foreground)" strokeDasharray="3 3" strokeWidth={1} />
            <circle cx={x(near.at)} cy={y(near.value)} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </>
        ) : null}
      </svg>
      {near ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] shadow-soft"
          style={{ left: `${Math.min(80, Math.max(0, (x(near.at) / W) * 100 - 10))}%` }}
        >
          <p className="font-semibold tabular-nums">{format(near.value)}</p>
          <p className="text-muted-foreground">{new Date(near.at).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" })}</p>
        </div>
      ) : null}
    </div>
  );
}

export interface Bar {
  key: string;
  label: string;
  value: number;
  detail: string;
}

/** Vertical bars (weeks), the last one highlighted, with a tooltip. */
export function BarChart({ bars, color, format, label, empty }: { bars: Bar[]; color: string; format: (v: number) => string; label: string; empty: string }) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const none = bars.every((b) => b.value <= 0);
  const W = Math.max(260, width);
  const H = W < 480 ? 150 : 170;
  const padL = 44;
  const padB = 20;
  const padT = 10;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const ys = ticks(0, max, 3);
  const top = ys.at(-1)!;
  const slot = (W - padL) / bars.length;
  const bw = Math.max(4, Math.min(28, slot - 4));
  const y = (v: number) => padT + (1 - v / top) * (H - padT - padB);
  const shown = hover === null ? null : bars[hover];

  if (none) {
    return (
      <div ref={box}>
        <p className="py-12 text-center text-[13px] text-muted-foreground">{empty}</p>
      </div>
    );
  }
  return (
    <div ref={box} className="relative" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-pan-y" role="img" aria-label={label}>
        {ys.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
              {format(t)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const cx = padL + slot * i + slot / 2;
          const h = Math.max(0, y(0) - y(b.value));
          return (
            <g key={b.key} onPointerEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={padL + slot * i} y={padT} width={slot} height={H - padT - padB} fill="transparent" />
              {b.value > 0 ? (
                <motion.rect
                  x={cx - bw / 2}
                  width={bw}
                  rx={Math.min(4, bw / 2)}
                  fill={color}
                  opacity={i === bars.length - 1 || hover === i ? 1 : 0.55}
                  initial={{ y: y(0), height: 0 }}
                  animate={{ y: y(b.value), height: h }}
                  transition={{ duration: 0.5, ease, delay: i * 0.02 }}
                />
              ) : null}
              {i % Math.ceil(bars.length / 6) === (bars.length - 1) % Math.ceil(bars.length / 6) ? (
                <text x={cx} y={H - 5} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {shown ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] shadow-soft"
          style={{ left: `${Math.min(75, Math.max(0, ((padL + slot * hover!) / W) * 100 - 10))}%` }}
        >
          <p className="font-semibold tabular-nums">{format(shown.value)}</p>
          <p className="text-muted-foreground">{shown.detail}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Horizontal bars: this week's sets per muscle against the recent average. */
export function MuscleBars({ rows, color }: { rows: { name: string; value: number; average: number }[]; color: string }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.value, r.average]));
  if (!rows.length) return <p className="py-8 text-center text-[13px] text-muted-foreground">Finish a workout to see which muscles it worked.</p>;
  return (
    <ul className="grid gap-2">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[88px_1fr_auto] items-center gap-3 text-[13px]">
          <span className="truncate text-muted-foreground">{r.name}</span>
          <span className="relative h-2.5 rounded-full bg-surface-muted">
            <motion.span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: color }}
              initial={{ width: 0 }}
              animate={{ width: `${(r.value / max) * 100}%` }}
              transition={{ duration: 0.5, ease }}
            />
            {r.average ? <span className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground/50" style={{ left: `${(r.average / max) * 100}%` }} title={`Average ${r.average.toFixed(1)} sets`} /> : null}
          </span>
          <span className={cn("w-14 text-right tabular-nums", r.value ? "font-medium" : "text-muted-foreground")}>
            {r.value} {r.value === 1 ? "set" : "sets"}
          </span>
        </li>
      ))}
    </ul>
  );
}
