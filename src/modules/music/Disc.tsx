import { useEffect, useRef, useState, type CSSProperties } from "react";

import { log } from "@/lib/log";
import { angleDelta, clock, seekTarget, type Palette } from "./logic";
import { audioFx } from "./native";

/** The disc's own spin while playing: 33⅓ rpm. */
const SPIN_MS = 1800;
const BANDS = 48;

/**
 * Where the visualiser's levels come from: the phone's audio (Android, with
 * the microphone permission), or an animation that only follows whether
 * music is playing.
 */
export type VisualSource = "audio" | "animated" | "off";

/** Polls the phone's visualiser while `on`; levels land in the returned ref. */
function useAudioBands(on: boolean, onFail: () => void) {
  const bands = useRef<number[] | null>(null);
  useEffect(() => {
    if (!on) return;
    let busy = false;
    let stopped = false;
    audioFx.visualizerStart().catch((e) => {
      log.warn(`visualiser failed: ${String(e)}`);
      if (!stopped) onFail();
    });
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      audioFx
        .visualizerFrame()
        .then((f) => {
          bands.current = f.age < 1000 ? f.bands : null;
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    }, 45);
    return () => {
      stopped = true;
      clearInterval(timer);
      bands.current = null;
      void audioFx.visualizerStop().catch(() => {});
    };
  }, [on, onFail]);
  return bands;
}

/** Smooth, slowly wandering levels for the animated visualiser. */
function animatedBand(i: number, t: number): number {
  const low = 1 - i / BANDS;
  const a = Math.sin(t * 0.0021 + i * 0.37) * 0.5 + 0.5;
  const b = Math.sin(t * 0.0057 + i * 1.13 + Math.sin(t * 0.0009) * 2) * 0.5 + 0.5;
  const c = Math.sin(t * 0.011 + i * 2.7) * 0.5 + 0.5;
  return Math.min(1, (0.18 + 0.5 * low) * (0.45 * a + 0.35 * b + 0.2 * c) + 0.08);
}

interface DiscProps {
  size: number;
  playing: boolean;
  art: string | null;
  durationMs: number;
  /** Current position (read every frame). */
  position: () => number;
  palette: Palette;
  visual: VisualSource;
  onVisualFail: () => void;
  onSeek: (ms: number) => void;
  onToggle: () => void;
}

/**
 * A record that spins while the song plays, with the cover on its label,
 * a progress ring around it and the visualiser outside that. Turning it
 * by hand moves the song: one full turn is one minute. A tap plays or
 * pauses.
 */
export function Disc({ size, playing, art, durationMs, position, palette, visual, onVisualFail, onSeek, onToggle }: DiscProps) {
  const pad = Math.round(size * 0.17);
  const full = size + pad * 2;
  const canvas = useRef<HTMLCanvasElement>(null);
  const rotor = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const levels = useRef<number[]>(Array(BANDS).fill(0));
  const drag = useRef<{ last: number; total: number; start: number; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const audio = useAudioBands(visual === "audio" && playing, onVisualFail);
  // Values the animation loop reads without restarting.
  const live = useRef({ playing, durationMs, position, palette, visual, preview });
  useEffect(() => {
    live.current = { playing, durationMs, position, palette, visual, preview };
  });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = full * dpr;
    el.height = full * dpr;
    const ctx = el.getContext("2d")!;
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const s = live.current;
      if (s.playing && !drag.current) angle.current = (angle.current + (dt / SPIN_MS) * 360) % 360;
      if (rotor.current) rotor.current.style.transform = `rotate(${angle.current}deg)`;

      // Levels rise at once and fall slowly, like a meter.
      const source = s.visual === "audio" ? audio.current : null;
      for (let i = 0; i < BANDS; i++) {
        const target = !s.playing || s.visual === "off" ? 0 : source ? (source[i] ?? 0) : animatedBand(i, now);
        const cur = levels.current[i];
        levels.current[i] = target > cur ? cur + (target - cur) * 0.6 : cur * 0.9 + target * 0.1;
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, full, full);
      const c = full / 2;
      const ring = size / 2 + Math.max(5, size * 0.022);
      const progress = s.durationMs ? (s.preview ?? s.position()) / s.durationMs : 0;

      // Visualiser: bars around the ring, mirrored left and right, bass at the top.
      const bars = BANDS * 2;
      const inner = ring + Math.max(7, size * 0.03);
      const room = pad - (inner - size / 2) - 4;
      ctx.lineCap = "round";
      ctx.strokeStyle = s.palette.accent;
      ctx.lineWidth = Math.max(2, ((2 * Math.PI * inner) / bars) * 0.5);
      for (let i = 0; i < bars; i++) {
        const band = i < BANDS ? i : bars - 1 - i;
        const level = levels.current[band];
        const len = 1.5 + level * room;
        const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
        ctx.globalAlpha = 0.35 + level * 0.6;
        ctx.beginPath();
        ctx.moveTo(c + Math.cos(a) * inner, c + Math.sin(a) * inner);
        ctx.lineTo(c + Math.cos(a) * (inner + len), c + Math.sin(a) * (inner + len));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Progress ring.
      const w = Math.max(3, size * 0.012);
      ctx.lineWidth = w;
      ctx.strokeStyle = s.palette.text;
      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      ctx.arc(c, c, ring, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.palette.accent;
      const end = -Math.PI / 2 + Math.min(1, Math.max(0, progress)) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(c, c, ring, -Math.PI / 2, end);
      ctx.stroke();
      ctx.fillStyle = s.palette.text;
      ctx.beginPath();
      ctx.arc(c + Math.cos(end) * ring, c + Math.sin(end) * ring, w * 1.35, 0, Math.PI * 2);
      ctx.fill();

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [full, size, pad, audio]);

  const pointerAngle = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  const discStyle: CSSProperties = {
    background: [
      "radial-gradient(circle, transparent 0 29%, rgba(0,0,0,0.55) 29.4% 30%, transparent 30.5%)",
      "repeating-radial-gradient(circle, #0c0c0e 0 1.2px, #1b1b1f 1.6px 3.4px)",
    ].join(","),
    boxShadow: `0 ${size * 0.05}px ${size * 0.14}px rgba(0,0,0,0.45), inset 0 0 0 ${Math.max(2, size * 0.008)}px rgba(255,255,255,0.05)`,
  };

  return (
    <div className="relative shrink-0 select-none" style={{ width: full, height: full }}>
      <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Turn the disc to move through the song: one turn is one minute"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(position() / 1000)}
        aria-valuetext={clock(position())}
        data-no-swipe
        className="absolute cursor-grab touch-none rounded-full outline-none focus-visible:ring-4 focus-visible:ring-current/30 active:cursor-grabbing"
        style={{ left: pad, top: pad, width: size, height: size }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            onSeek(Math.min(Math.max(position() + (e.key === "ArrowRight" ? 10_000 : -10_000), 0), durationMs));
          } else if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onToggle();
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { last: pointerAngle(e), total: 0, start: position(), moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const a = pointerAngle(e);
          const delta = angleDelta(d.last, a);
          d.last = a;
          d.total += delta;
          angle.current += (delta * 180) / Math.PI;
          if (!d.moved && Math.abs(d.total) > 0.08) d.moved = true;
          if (d.moved) setPreview(seekTarget(d.start, d.total, durationMs));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          setPreview(null);
          if (!d) return;
          if (d.moved) onSeek(seekTarget(d.start, d.total, durationMs));
          else onToggle();
        }}
        onPointerCancel={() => {
          drag.current = null;
          setPreview(null);
        }}
      >
        <div ref={rotor} className="relative size-full rounded-full" style={discStyle}>
          <div className="absolute overflow-hidden rounded-full bg-black/40" style={{ inset: "21%" }}>
            {art ? <img src={art} alt="" draggable={false} className="size-full object-cover" /> : null}
          </div>
          <span className="absolute left-1/2 top-1/2 size-[4.5%] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)]" style={{ background: palette.bg }} />
        </div>
        {/* Light on the vinyl stays put while the record turns. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-full mix-blend-screen"
          style={{
            background:
              "conic-gradient(from 20deg, transparent 0 12%, rgba(255,255,255,0.11) 19%, transparent 27% 62%, rgba(255,255,255,0.08) 69%, transparent 77%)",
            maskImage: "radial-gradient(circle, transparent 0 30%, #000 31%)",
          }}
        />
        {preview !== null ? (
          <span className="pointer-events-none absolute left-1/2 top-[8%] -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[14px] font-semibold tabular-nums text-white shadow-lg">
            {clock(preview)}
          </span>
        ) : null}
      </div>
    </div>
  );
}
