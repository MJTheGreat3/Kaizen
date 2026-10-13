/** Today's activity card: overall streak and the last five weeks at a glance. */
import { useMemo } from "react";
import { Fire } from "@phosphor-icons/react";

import { addDaysKey, todayKey } from "@/lib/dates";
import { useActivity } from "./data";
import { activeDays, streak, totalsByDay, weekColumns } from "./logic";

export function ActivityGlance({ hue }: { hue: string }) {
  const activity = useActivity();
  const view = useMemo(() => {
    if (!activity.data) return null;
    const today = todayKey();
    const totals = totalsByDay(activity.data.events);
    const perDay = new Map<string, string[]>();
    const all = new Set<string>();
    for (const t of activity.data.types) {
      for (const d of activeDays(totals.get(t.id), t.rule)) {
        all.add(d);
        perDay.set(d, [...(perDay.get(d) ?? []), t.color]);
      }
    }
    const overall = streak(all, { period: "day", min: 1, perWeek: 1, restDays: [], freezesPerMonth: 0 }, today);
    return { today, perDay, overall, cols: weekColumns(addDaysKey(today, -34), today) };
  }, [activity.data]);

  if (!view) return <div className="h-24" />;
  const max = Math.max(1, ...[...view.perDay.values()].map((c) => c.length));
  return (
    <div className="flex items-center gap-5">
      <div className="grid shrink-0 justify-items-start">
        <span className="flex items-end gap-1.5">
          <Fire size={26} weight={view.overall.current ? "fill" : "regular"} style={{ color: view.overall.current ? hue : "var(--muted-foreground)" }} />
          <span className="text-[34px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{view.overall.current}</span>
        </span>
        <span className="mt-1 text-[12px] text-muted-foreground">
          {view.overall.current === 1 ? "day" : "days"} in a row{view.overall.current && !view.overall.doneNow ? " · not yet today" : ""}
        </span>
      </div>
      <div className="ml-auto grid auto-cols-[14px] grid-flow-col grid-rows-7 gap-[3px]" aria-label="Last five weeks">
        {view.cols.flat().map((d) => {
          const colors = view.perDay.get(d) ?? [];
          const future = d > view.today;
          return (
            <span
              key={d}
              className="size-[14px] rounded-[3px]"
              style={{
                background: future
                  ? "transparent"
                  : colors.length
                    ? `color-mix(in srgb, ${hue} ${30 + (70 * colors.length) / max}%, var(--surface-muted))`
                    : "var(--surface-muted)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
