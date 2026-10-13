import type { ReactNode } from "react";
import { motion } from "motion/react";

import { rise } from "@/lib/motion";

export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <motion.section variants={rise} className="grid gap-3">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-[14px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-soft">{children}</div>
    </motion.section>
  );
}

export function Row({
  label,
  description,
  children,
  inline,
}: {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Keep the control beside the label on narrow screens (switches). */
  inline?: boolean;
}) {
  return (
    <div
      className={
        inline
          ? "flex items-center justify-between gap-6 px-4 py-4 md:px-5"
          : "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6 md:px-5"
      }
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="text-[15px] font-medium">{label}</span>
        {description ? <span className="text-[13px] leading-relaxed text-muted-foreground">{description}</span> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

