import type { ReactNode } from "react";
import { motion } from "motion/react";

import { ease } from "@/lib/motion";

/** Circular progress (0 to 1) with optional centre content. */
export function ProgressRing({
  value,
  hue,
  size = 56,
  stroke = 6,
  children,
}: {
  value: number;
  hue: string;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-muted)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hue}
          strokeWidth={stroke}
          strokeLinecap="round"
          initial={false}
          animate={{ pathLength: clamped, opacity: clamped > 0 ? 1 : 0 }}
          transition={{ duration: 0.6, ease }}
        />
      </svg>
      {children ? <span className="absolute inset-0 grid place-items-center">{children}</span> : null}
    </span>
  );
}
