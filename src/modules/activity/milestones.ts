/**
 * Streak milestones (7, 30, 100, 365) celebrated once each, plus the
 * streak list the notification plan uses for its evening nudge.
 */
import { toast } from "sonner";

import { notify, useAfterChanges } from "@/core/afterChanges";
import { getPref, setPref } from "@/core/db/prefs";
import { todayKey } from "@/lib/dates";
import { loadActivity } from "./data";
import { activeDays, milestoneAt, streak, totalsByDay } from "./logic";

export async function currentStreaks() {
  const { types, events } = await loadActivity();
  const totals = totalsByDay(events);
  const today = todayKey();
  return types.map((t) => {
    const s = streak(activeDays(totals.get(t.id), t.rule), t.rule, today);
    return { id: t.id, name: t.name, current: s.current, since: s.since, doneToday: s.doneNow, unit: s.unit };
  });
}

async function celebrate() {
  const [streaks, celebrated] = await Promise.all([currentStreaks(), getPref("streak.celebrated")]);
  const next = { ...celebrated };
  for (const s of streaks) {
    const m = milestoneAt(s.current);
    if (!m || !s.since) continue;
    const mark = `${s.since}:${m}`;
    if (celebrated[s.id] === mark) continue;
    next[s.id] = mark;
    const unit = s.unit === "weeks" ? "weeks" : "days";
    toast.success(`${m} ${unit} of ${s.name}`, { description: "A new streak milestone. Keep going." });
    await notify(`${m}-${unit.slice(0, -1)} ${s.name} streak`, "A new milestone. Keep going.");
  }
  if (JSON.stringify(next) !== JSON.stringify(celebrated)) await setPref("streak.celebrated", next);
}

/** Checks for new milestones after unlocking and after each change. */
export function useStreakMilestones(enabled: boolean) {
  useAfterChanges(enabled, "milestones", celebrate);
}
