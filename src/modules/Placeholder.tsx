import { motion } from "motion/react";
import { Check } from "@phosphor-icons/react";

import { Page, PageHeader } from "@/core/shell/PageHeader";
import { rise } from "@/lib/motion";
import type { ModuleDef } from "./registry";

const LAST_PHASE = 9;
const DONE_PHASE = 0;

/** Stand-in page for modules that later phases will build. */
export function Placeholder({ module }: { module: ModuleDef }) {
  return (
    <Page hue={module.hue}>
      <PageHeader title={module.title} description={module.summary} icon={module.icon} hue={module.hue} />

      <div className="mt-10 grid gap-4 md:grid-cols-[1.5fr_1fr]">
        <motion.section
          variants={rise}
          className="rounded-2xl border border-border bg-surface p-6 shadow-soft md:p-8"
          style={{ ["--hue" as string]: module.hue }}
        >
          <h2 className="text-[17px] font-semibold tracking-tight">What this space will hold</h2>
          <ul className="mt-5 grid gap-3">
            {module.planned.map((item) => (
              <li key={item} className="flex items-start gap-3 text-[15px] leading-snug">
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--hue)_18%,transparent)] text-[var(--hue)]">
                  <Check size={12} weight="bold" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </motion.section>

        <motion.section variants={rise} className="rounded-2xl border border-border bg-surface p-6 shadow-soft md:p-8">
          <p className="text-[13px] font-medium text-muted-foreground">Arrives in</p>
          <p className="mt-1 text-[28px] font-semibold leading-none tracking-tight">
            Phase {module.phase}
            <span className="text-muted-foreground"> / {LAST_PHASE}</span>
          </p>
          <PhaseTrack phase={module.phase} hue={module.hue} />
        </motion.section>
      </div>
    </Page>
  );
}

function PhaseTrack({ phase, hue }: { phase: number; hue: string }) {
  return (
    <div className="mt-6" aria-hidden>
      <div className="relative flex items-center justify-between">
        <div className="absolute inset-x-1 h-px bg-border" />
        {Array.from({ length: LAST_PHASE + 1 }, (_, i) => {
          const done = i <= DONE_PHASE;
          const target = i === phase;
          return (
            <motion.span
              key={i}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.25 + i * 0.035, type: "spring", stiffness: 500, damping: 28 }}
              className="relative grid size-3.5 place-items-center rounded-full"
              style={{
                background: done ? "var(--accent)" : target ? hue : "var(--surface)",
                boxShadow: target
                  ? `0 0 0 4px color-mix(in srgb, ${hue} 22%, transparent)`
                  : done
                    ? "none"
                    : "inset 0 0 0 1.5px var(--input)",
              }}
            />
          );
        })}
      </div>
      <div className="mt-2.5 flex justify-between text-[11px] font-medium text-muted-foreground">
        <span>Now</span>
        <span>Done</span>
      </div>
    </div>
  );
}
