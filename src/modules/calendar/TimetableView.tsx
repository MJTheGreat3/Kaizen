import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarPlus,
  CaretLeft,
  CaretRight,
  Copy,
  Plus,
  SunHorizon,
  Trash,
  UmbrellaSimple,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { EmptyState, RowMenu, SectionTitle } from "@/components/ui/kit";
import type { Subject, TimetableSlot } from "@/core/db/schema";
import { useOpenTarget } from "@/core/shell/openRequest";
import { addDaysKey, formatMinutes, fromKey, isoWeekday, relativeDay, todayKey, type DateKey } from "@/lib/dates";
import { ease } from "@/lib/motion";
import { PALETTE } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { WEEKDAYS } from "@/modules/habits/streaks";
import { dayOff, occurrencesOn, type Occurrence } from "./attendance";
import { ClassList } from "./ClassList";
import { useDeleteException, type CalendarData } from "./data";
import { BreakDialog, CopyDayDialog, ExtraClassDialog, SlotDialog, SubjectDialog } from "./dialogs";
import { KIND_LABEL } from "./labels";

const PX_PER_MIN = 0.95;

function weekStartOf(day: DateKey) {
  return addDaysKey(day, 1 - isoWeekday(day));
}

type SlotEditor = { open: boolean; slot: TimetableSlot | null; defaults?: { weekday?: number; startMin?: number } };

function WeekGrid({
  data,
  days,
  occurrences,
  onAdd,
  onEdit,
}: {
  data: CalendarData;
  days: DateKey[];
  occurrences: Map<DateKey, Occurrence[]>;
  onAdd: (weekday: number, startMin: number) => void;
  onEdit: (slot: TimetableSlot) => void;
}) {
  const today = todayKey();
  const all = [...occurrences.values()].flat();
  const startHour = Math.min(8, ...all.map((o) => Math.floor(o.startMin / 60)));
  const endHour = Math.max(18, ...all.map((o) => Math.ceil(o.endMin / 60)));
  const from = startHour * 60;
  const height = (endHour - startHour) * 60 * PX_PER_MIN;
  const subjects = new Map(data.subjects.map((s) => [s.id, s]));
  const slots = new Map(data.slots.map((s) => [s.id, s]));

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-soft">
      <div className="grid border-b border-border" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <span />
        {days.map((d) => (
          <div key={d} className={cn("px-2 py-3 text-center", d === today && "text-accent")}>
            <p className="text-[12px] font-medium text-muted-foreground">{WEEKDAYS[isoWeekday(d) - 1]}</p>
            <p className={cn("mx-auto mt-0.5 grid size-8 place-items-center rounded-full text-[15px] font-semibold", d === today && "bg-accent text-accent-foreground")}>
              {fromKey(d).getDate()}
            </p>
          </div>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="relative" style={{ height }}>
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <span key={i} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: i * 60 * PX_PER_MIN }}>
              {i === 0 ? "" : formatMinutes((startHour + i) * 60).replace(":00", "")}
            </span>
          ))}
        </div>
        {days.map((d) => {
          const off = dayOff(data.exceptions, d);
          return (
            <div
              key={d}
              className="relative border-l border-border/70"
              style={{ height }}
              onClick={(e) => {
                if (off) return;
                const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                const minute = from + Math.floor(y / PX_PER_MIN / 60) * 60;
                onAdd(isoWeekday(d), minute);
              }}
            >
              {Array.from({ length: endHour - startHour }, (_, i) => (
                <span key={i} className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: i * 60 * PX_PER_MIN }} />
              ))}
              {off ? (
                <div className="absolute inset-1 grid place-items-center rounded-xl bg-[repeating-linear-gradient(135deg,var(--surface-muted)_0_8px,transparent_8px_16px)]">
                  <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-muted-foreground shadow-soft">{off.title ?? "Holiday"}</span>
                </div>
              ) : null}
              {(occurrences.get(d) ?? []).map((o) => {
                const subject = subjects.get(o.subjectId);
                if (!subject) return null;
                return (
                  <motion.button
                    key={o.key}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: o.cancelled ? 0.5 : 1, scale: 1 }}
                    transition={{ duration: 0.3, ease }}
                    onClick={(e) => {
                      e.stopPropagation();
                      const slot = o.slotId ? slots.get(o.slotId) : null;
                      if (slot) onEdit(slot);
                    }}
                    className={cn(
                      "absolute inset-x-1 overflow-hidden rounded-lg px-2 py-1.5 text-left transition-[filter] hover:brightness-[0.97]",
                      o.extraId && "outline-dashed outline-1",
                    )}
                    style={{
                      top: (o.startMin - from) * PX_PER_MIN + 1,
                      height: Math.max(26, (o.endMin - o.startMin) * PX_PER_MIN - 2),
                      background: `color-mix(in srgb, ${subject.color} 16%, var(--surface))`,
                      boxShadow: `inset 3px 0 0 ${subject.color}`,
                      outlineColor: subject.color,
                    }}
                  >
                    <p className={cn("truncate text-[12.5px] font-semibold leading-tight", o.cancelled && "line-through")} style={{ color: `color-mix(in srgb, ${subject.color} 70%, var(--foreground))` }}>
                      {subject.code || subject.name}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {o.kind !== "lecture" ? `${KIND_LABEL[o.kind]} ` : ""}
                      {o.room ?? ""}
                    </p>
                  </motion.button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimetableView({ data }: { data: CalendarData }) {
  const semester = data.semester!;
  const today = todayKey();
  const [weekStart, setWeekStart] = useState(weekStartOf(today));
  const [selected, setSelected] = useState(today);
  const [slotEditor, setSlotEditor] = useState<SlotEditor>({ open: false, slot: null });
  const [subjectEditor, setSubjectEditor] = useState<{ open: boolean; subject: Subject | null }>({ open: false, subject: null });
  const [extraOpen, setExtraOpen] = useState(false);
  const [breakOpen, setBreakOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const deleteException = useDeleteException();
  useOpenTarget(["subjects"], true, ({ id }) => {
    const subject = data.subjects.find((x) => x.id === id);
    if (subject) setSubjectEditor({ open: true, subject });
  });

  const hasWeekend = (wd: number) =>
    data.slots.some((s) => s.weekday === wd) || data.exceptions.some((e) => e.kind === "extra" && isoWeekday(e.date) === wd);
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i)).filter((d) => isoWeekday(d) <= 5 || hasWeekend(isoWeekday(d)));
  const occurrences = useMemo(() => {
    const m = new Map<DateKey, Occurrence[]>();
    for (let i = 0; i < 7; i++) {
      const d = addDaysKey(weekStart, i);
      m.set(d, occurrencesOn(semester, data.slots, data.exceptions, d));
    }
    return m;
  }, [semester, data.slots, data.exceptions, weekStart]);
  const marks = useMemo(() => new Map(data.marks.map((m) => [m.classKey, m.status])), [data.marks]);
  const now = new Date();
  const nowInfo = { day: today, minutes: now.getHours() * 60 + now.getMinutes() };
  const breaks = data.exceptions.filter((e) => e.kind === "holiday" || e.kind === "vacation").sort((a, b) => (a.date < b.date ? -1 : 1));

  if (!data.subjects.length) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-soft">
        <EmptyState
          icon={CalendarPlus}
          hue="#d9608f"
          title="Add your subjects"
          action={
            <Button onClick={() => setSubjectEditor({ open: true, subject: null })}>
              <Plus />
              Add a subject
            </Button>
          }
        >
          Start with the subjects you're taking this semester, then place their classes on the weekly timetable.
        </EmptyState>
        <SubjectDialog
          key={`sub-${subjectEditor.open}`}
          subject={null}
          semester={semester}
          open={subjectEditor.open}
          defaultColor={PALETTE[data.subjects.length % PALETTE.length]}
          onClose={() => setSubjectEditor({ open: false, subject: null })}
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {data.subjects.map((s) => (
          <button
            key={s.id}
            onClick={() => setSubjectEditor({ open: true, subject: s })}
            className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-surface px-3 text-[13px] font-medium shadow-soft transition-transform active:scale-95"
          >
            <span className="size-2.5 rounded-full" style={{ background: s.color }} />
            {s.name}
          </button>
        ))}
        <Button variant="ghost" size="sm" onClick={() => setSubjectEditor({ open: true, subject: null })}>
          <Plus />
          Subject
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="icon-sm" aria-label="Previous week" onClick={() => setWeekStart(addDaysKey(weekStart, -7))}>
            <CaretLeft />
          </Button>
          <Button variant="secondary" size="icon-sm" aria-label="Next week" onClick={() => setWeekStart(addDaysKey(weekStart, 7))}>
            <CaretRight />
          </Button>
          <span className="ml-2 text-[14px] font-medium">
            {weekStart === weekStartOf(today) ? "This week" : `Week of ${relativeDay(weekStart)}`}
          </span>
          {weekStart !== weekStartOf(today) ? (
            <Button variant="ghost" size="sm" onClick={() => setWeekStart(weekStartOf(today))}>
              Today
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setSlotEditor({ open: true, slot: null, defaults: { weekday: isoWeekday(selected) } })}>
            <Plus />
            Weekly class
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setExtraOpen(true)}>
            <CalendarPlus />
            Extra class
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setBreakOpen(true)}>
            <UmbrellaSimple />
            Holiday
          </Button>
          {data.slots.length ? (
            <Button variant="secondary" size="sm" onClick={() => setCopyOpen(true)}>
              <Copy />
              Copy day
            </Button>
          ) : null}
        </div>
      </div>

      <div className="hidden md:block">
        <WeekGrid
          data={data}
          days={days}
          occurrences={occurrences}
          onAdd={(weekday, startMin) => setSlotEditor({ open: true, slot: null, defaults: { weekday, startMin } })}
          onEdit={(slot) => setSlotEditor({ open: true, slot })}
        />
        <p className="mt-2 text-[12px] text-muted-foreground">Click an empty spot to add a class there, or a class to edit it. Cancel single classes from the day list.</p>
      </div>

      <div className="grid gap-3">
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {Array.from({ length: 7 }, (_, i) => addDaysKey(weekStart, i)).map((d) => {
            const active = d === selected;
            const count = (occurrences.get(d) ?? []).filter((o) => !o.cancelled).length;
            return (
              <button
                key={d}
                onClick={() => setSelected(d)}
                className={cn(
                  "flex min-w-12 flex-1 flex-col items-center gap-0.5 rounded-xl border py-2 transition-colors",
                  active ? "border-transparent bg-accent text-accent-foreground shadow-soft" : "border-border bg-surface",
                )}
              >
                <span className={cn("text-[11px] font-medium", !active && "text-muted-foreground")}>{WEEKDAYS[isoWeekday(d) - 1]}</span>
                <span className="text-[16px] font-semibold">{fromKey(d).getDate()}</span>
                <span className={cn("h-1 w-4 rounded-full", count ? (active ? "bg-accent-foreground/70" : "bg-[#d9608f]") : "bg-transparent")} />
              </button>
            );
          })}
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={selected} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            {(() => {
              const off = dayOff(data.exceptions, selected);
              const list = occurrences.get(selected) ?? occurrencesOn(semester, data.slots, data.exceptions, selected);
              if (off) return <p className="rounded-xl bg-surface-muted px-4 py-6 text-center text-[14px] text-muted-foreground">{off.title ?? "Holiday"}: no classes.</p>;
              if (!list.length) return <p className="rounded-xl bg-surface-muted px-4 py-6 text-center text-[14px] text-muted-foreground">No classes on {relativeDay(selected).toLowerCase()}.</p>;
              return <ClassList occurrences={list} subjects={data.subjects} marks={marks} semester={semester} now={nowInfo} />;
            })()}
          </motion.div>
        </AnimatePresence>
      </div>

      {breaks.length ? (
        <section>
          <SectionTitle>Holidays and vacations</SectionTitle>
          <ul className="grid gap-2">
            {breaks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3">
                <SunHorizon size={18} className="text-muted-foreground" />
                <span className="flex-1 text-[14px]">
                  <span className="font-medium">{b.title}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    {relativeDay(b.date)}
                    {b.kind === "vacation" && b.endDate ? ` to ${relativeDay(b.endDate)}` : ""}
                  </span>
                </span>
                <RowMenu items={[{ label: "Remove", icon: Trash, danger: true, onSelect: () => deleteException.mutate(b.id) }]} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <SlotDialog
        key={`slot-${slotEditor.slot?.id ?? "new"}-${slotEditor.open}`}
        slot={slotEditor.slot}
        defaults={slotEditor.defaults}
        subjects={data.subjects}
        semester={semester}
        open={slotEditor.open}
        onClose={() => setSlotEditor({ open: false, slot: null })}
      />
      <SubjectDialog
        key={`sub-${subjectEditor.subject?.id ?? "new"}-${subjectEditor.open}`}
        subject={subjectEditor.subject}
        semester={semester}
        open={subjectEditor.open}
        defaultColor={PALETTE[(data.subjects.length * 3) % PALETTE.length]}
        onClose={() => setSubjectEditor({ open: false, subject: null })}
      />
      <ExtraClassDialog key={`extra-${extraOpen}`} semester={semester} subjects={data.subjects} open={extraOpen} defaultDate={selected} onClose={() => setExtraOpen(false)} />
      <BreakDialog key={`break-${breakOpen}`} semester={semester} open={breakOpen} onClose={() => setBreakOpen(false)} />
      <CopyDayDialog key={`copy-${copyOpen}`} semester={semester} slots={data.slots} open={copyOpen} onClose={() => setCopyOpen(false)} />
    </div>
  );
}
