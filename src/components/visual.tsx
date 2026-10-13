import type { CSSProperties, ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { dayPeriod, useNow, type DayPeriod } from "@/lib/time";

// ---------------------------------------------------------------------------
// Sky: a slowly drifting gradient that follows the time of day.
// ---------------------------------------------------------------------------

const skies: Record<DayPeriod, { base: string; blobs: [string, string, string] }> = {
  morning: {
    base: "linear-gradient(160deg, #f9c98a 0%, #ef8f78 48%, #7d9fe0 100%)",
    blobs: ["#ffd9a0", "#f07f8a", "#8fb7f2"],
  },
  day: {
    base: "linear-gradient(160deg, #8fd0f2 0%, #4a92dc 55%, #2f6fbf 100%)",
    blobs: ["#bfe8ff", "#5ad1c4", "#3c7fd6"],
  },
  evening: {
    base: "linear-gradient(160deg, #f6a06a 0%, #d76489 50%, #424a9e 100%)",
    blobs: ["#ffbf7a", "#e2588a", "#3d4aa6"],
  },
  night: {
    base: "linear-gradient(160deg, #1b2150 0%, #23307a 55%, #12454f 100%)",
    blobs: ["#3445a8", "#1f7d86", "#5a3f9e"],
  },
};

const blobPlacement: CSSProperties[] = [
  { left: "-15%", top: "-25%", width: "70%" },
  { right: "-20%", top: "10%", width: "65%" },
  { left: "15%", bottom: "-35%", width: "75%" },
];

export function Sky({ className, children }: { className?: string; children?: ReactNode }) {
  const now = useNow(60_000);
  const sky = skies[dayPeriod(now)];
  const reduce = useReducedMotion();

  return (
    <div className={cn("relative isolate overflow-hidden", className)} style={{ background: sky.base }}>
      {sky.blobs.map((color, i) => (
        <motion.div
          key={i}
          aria-hidden
          className="absolute aspect-square rounded-full opacity-70 blur-3xl"
          style={{ background: color, ...blobPlacement[i] }}
          animate={
            reduce
              ? undefined
              : { x: [0, 36 - i * 20, -24 + i * 8, 0], y: [0, -28 + i * 12, 18, 0], scale: [1, 1.08, 0.96, 1] }
          }
          transition={{ duration: 22 + i * 6, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      {/* Darkens the lower part so white text stays readable on light skies. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(to_top,rgb(10_12_32/0.55),rgb(10_12_32/0.08)_55%,transparent)]"
      />
      <div aria-hidden className="grain-surface absolute inset-0 opacity-[0.18] mix-blend-overlay" />
      <div className="relative h-full">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Module icon tile
// ---------------------------------------------------------------------------

const tileSizes = {
  sm: { box: "size-7 rounded-[9px]", icon: 16 },
  md: { box: "size-10 rounded-xl", icon: 21 },
  lg: { box: "size-16 rounded-[20px]", icon: 32 },
};

export function ModuleTile({
  icon: Icon,
  hue,
  size = "md",
  className,
}: {
  icon: Icon;
  hue: string;
  size?: keyof typeof tileSizes;
  className?: string;
}) {
  const s = tileSizes[size];
  return (
    <span
      aria-hidden
      className={cn("relative grid shrink-0 place-items-center text-white", s.box, className)}
      style={{
        background: `linear-gradient(150deg, color-mix(in oklch, ${hue} 85%, white), color-mix(in oklch, ${hue} 80%, black))`,
        boxShadow: `inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -1px 0 rgb(0 0 0 / 0.12), 0 8px 18px -8px color-mix(in oklch, ${hue} 80%, transparent)`,
      }}
    >
      <Icon size={s.icon} weight="duotone" />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Soft colour wash behind a page header
// ---------------------------------------------------------------------------

export function Wash({ hue, className }: { hue: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-[var(--wash-opacity)]", className)}
      style={{
        background: `radial-gradient(60% 70% at 12% 0%, color-mix(in oklch, ${hue} 26%, transparent), transparent 70%), radial-gradient(40% 50% at 85% 5%, color-mix(in oklch, ${hue} 14%, transparent), transparent 70%)`,
      }}
    />
  );
}

/** Brand mark: the first character of 改善 (kaizen) on the accent tile. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-8 place-items-center rounded-[10px] bg-accent text-[14px] font-semibold text-accent-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_6px_14px_-6px_var(--accent)]",
        className,
      )}
    >
      改
    </span>
  );
}
