/** Today's goals card: the active goals closest to their finish date first. */
import { motion } from "motion/react";

import { ease } from "@/lib/motion";
import type { GoalView } from "./data";
import { goalAmount } from "./format";
import { isCheckGoal, PACE_LABEL } from "./logic";

export function GoalsGlance({ goals }: { goals: GoalView[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      {goals.map((v) => {
        const p = v.progress;
        return (
          <li key={v.goal.id} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-[14px]">
              <span className="truncate font-medium">{v.goal.title}</span>
              <span className="shrink-0 text-[12px] text-muted-foreground">
                {p.pace !== "none" ? `${PACE_LABEL[p.pace]} · ` : ""}
                {isCheckGoal(v.goal) ? (v.goal.status === "done" ? "Done" : "Not done yet") : `${goalAmount(v, p.current)} / ${goalAmount(v, p.target)}`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <motion.div
                className="h-full rounded-full"
                style={{ background: v.goal.color }}
                initial={{ width: 0 }}
                animate={{ width: `${p.fraction * 100}%` }}
                transition={{ duration: 0.7, ease }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
