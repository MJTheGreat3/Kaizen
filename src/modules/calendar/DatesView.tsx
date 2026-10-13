import { useState } from "react";
import { motion } from "motion/react";
import { CalendarHeart, Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { EmptyState, SectionTitle } from "@/components/ui/kit";
import type { ImportantDate } from "@/core/db/schema";
import { useOpenTarget } from "@/core/shell/openRequest";
import { daysBetween, formatLongDate, todayKey } from "@/lib/dates";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { nextOccurrence, useDates } from "./data";
import { DateDialog } from "./dialogs";
import { countdown, DATE_STYLE } from "./labels";

function ageOn(item: ImportantDate, on: string): number | null {
  if (item.kind !== "birthday" && item.kind !== "anniversary") return null;
  const years = Number(on.slice(0, 4)) - Number(item.date.slice(0, 4));
  return years > 0 ? years : null;
}

function DateRow({ item, date, onOpen, index }: { item: ImportantDate; date: string; onOpen: () => void; index: number }) {
  const style = DATE_STYLE[item.kind] ?? DATE_STYLE.other;
  const age = ageOn(item, date);
  const days = daysBetween(todayKey(), date);
  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease, delay: Math.min(index, 10) * 0.03 }}
      onClick={onOpen}
      className="flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-muted/70"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${style.hue} 14%, transparent)`, color: style.hue }}>
        <style.icon size={22} weight="duotone" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium">{item.title}</span>
        <span className="text-[13px] text-muted-foreground">
          {formatLongDate(date)}
          {age ? `, ${item.kind === "birthday" ? "turns" : ""} ${age}${item.kind === "anniversary" ? " years" : ""}` : ""}
        </span>
      </span>
      <span
        className={cn("shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold", days <= 1 ? "text-white" : "bg-surface-muted text-muted-foreground")}
        style={days <= 1 && days >= 0 ? { background: style.hue } : undefined}
      >
        {countdown(date)}
      </span>
    </motion.button>
  );
}

export function DatesView() {
  const { data } = useDates();
  const [editor, setEditor] = useState<{ open: boolean; item: ImportantDate | null }>({ open: false, item: null });
  const today = todayKey();
  useOpenTarget(["dates"], !!data, ({ id }) => {
    const item = data?.find((x) => x.id === id);
    if (item) setEditor({ open: true, item });
  });
  const items = (data ?? []).map((item) => ({ item, next: nextOccurrence(item, today) }));
  const upcoming = items.filter((x) => x.next).sort((a, b) => (a.next! < b.next! ? -1 : 1));
  const soon = upcoming.filter((x) => daysBetween(today, x.next!) <= 30);
  const later = upcoming.filter((x) => daysBetween(today, x.next!) > 30);
  const past = items.filter((x) => !x.next).sort((a, b) => (a.item.date < b.item.date ? 1 : -1));

  return (
    <div className="grid gap-6">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditor({ open: true, item: null })}>
          <Plus />
          Add date
        </Button>
      </div>
      {!items.length ? (
        <div className="rounded-2xl border border-border bg-surface shadow-soft">
          <EmptyState icon={CalendarHeart} hue="#d9608f" title="No dates yet">
            Birthdays, exams, deadlines and renewals, with countdowns and reminders.
          </EmptyState>
        </div>
      ) : (
        [
          ["Next 30 days", soon],
          ["Later", later],
          ["Past", past.map((x) => ({ ...x, next: x.item.date }))],
        ].map(([title, list]) =>
          (list as typeof upcoming).length ? (
            <section key={title as string}>
              <SectionTitle>{title as string}</SectionTitle>
              <div className="rounded-2xl border border-border bg-surface p-2 shadow-soft">
                {(list as typeof upcoming).map((x, i) => (
                  <DateRow key={x.item.id} item={x.item} date={x.next!} index={i} onOpen={() => setEditor({ open: true, item: x.item })} />
                ))}
              </div>
            </section>
          ) : null,
        )
      )}
      <DateDialog key={`${editor.item?.id ?? "new"}-${editor.open}`} item={editor.item} open={editor.open} onClose={() => setEditor({ open: false, item: null })} />
    </div>
  );
}
