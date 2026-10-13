/** Marks goals done when they reach their target, with a celebration. */
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { notify, useAfterChanges } from "@/core/afterChanges";
import { loadGoals, setGoalStatus } from "./data";
import { goalAmount } from "./format";
import { justReached, PACE_LABEL } from "./logic";

export function useGoalCompletion(enabled: boolean) {
  const client = useQueryClient();
  useAfterChanges(enabled, "goal check", async () => {
    const reached = (await loadGoals()).filter((v) => justReached(v.goal, v.progress));
    for (const { goal } of reached) {
      await setGoalStatus(goal.id, "done");
      toast.success(`Goal reached: ${goal.title}`, { description: "Well done. It's in Goals → Reached." });
      await notify("Goal reached", goal.title);
    }
    if (reached.length) await client.invalidateQueries({ queryKey: ["goals"] });
  });
}

/** Active goals with a finish date, for the notification plan. */
export async function goalReminders() {
  return (await loadGoals())
    .filter((v) => v.goal.status === "active" && v.goal.targetDate)
    .map((v) => {
      const p = v.progress;
      const left = p.target - p.current;
      const pace = p.pace !== "none" ? `${PACE_LABEL[p.pace]}: ` : "";
      return {
        id: v.goal.id,
        title: v.goal.title,
        targetDate: v.goal.targetDate!,
        left: v.goal.kind === "manual" ? `${pace}at ${goalAmount(v, p.current)} of ${goalAmount(v, p.target)}` : `${pace}${goalAmount(v, Math.max(0, left))} to go`,
      };
    });
}
