import { amount } from "@/modules/activity/format";
import type { GoalView } from "./data";

const round = (n: number) => Math.round(n * 10) / 10;

/** A goal's value in its own unit: activity amounts read naturally, others use the goal's unit. */
export function goalAmount(v: GoalView, n: number) {
  const { goal } = v;
  if (goal.kind === "activity" && goal.activityType) return amount(goal.activityType, n);
  if (goal.kind === "habits") return `${round(n)} ${round(n) === 1 ? "check-in" : "check-ins"}`;
  if (goal.kind === "tasks") return `${round(n)} ${round(n) === 1 ? "task" : "tasks"}`;
  return `${round(n).toLocaleString()}${goal.unit ? ` ${goal.unit}` : ""}`;
}

/** Active goals for the Today card, nearest finish date first. */
export function activeGoals(goals: GoalView[] | undefined) {
  return (goals ?? [])
    .filter((v) => v.goal.status === "active")
    .sort((a, b) => (a.goal.targetDate ?? "9999").localeCompare(b.goal.targetDate ?? "9999"))
    .slice(0, 4);
}
