/**
 * Streak milestones (7, 30, 100, 365) celebrated once each, plus the
 * streak list the notification plan uses for its evening nudge.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getPref, setPref } from "@/core/db/prefs";
import { todayKey } from "@/lib/dates";
import { log } from "@/lib/log";
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
    try {
      const n = await import("@tauri-apps/plugin-notification");
      if ((await n.isPermissionGranted()) === true) n.sendNotification({ title: `${m}-${unit.slice(0, -1)} ${s.name} streak`, body: "A new milestone. Keep going." });
    } catch {
      // The toast is enough.
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(celebrated)) await setPref("streak.celebrated", next);
}

/** Checks for new milestones after unlocking and after each change. */
export function useStreakMilestones(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => celebrate().catch((e) => log.warn(`milestones failed: ${String(e)}`)), 2_500);
    };
    soon();
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") soon();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, client]);
}
