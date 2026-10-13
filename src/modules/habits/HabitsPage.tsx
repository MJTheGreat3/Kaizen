import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Archive, Bell, Fire, Minus, PencilSimple, Plus, Target, Trash } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Segmented, Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { CheckCircle, ColorPicker, ConfirmDialog, DateTimeInput, EmptyState, PillToggle, RowMenu } from "@/components/ui/kit";
import { ProgressRing } from "@/components/ui/ring";
import type { Habit, HabitSchedule } from "@/core/db/schema";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { addDaysKey, fromKey, todayKey } from "@/lib/dates";
import { ease, rise } from "@/lib/motion";
import { PALETTE } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { modules } from "@/modules/registry";
import { useArchiveHabit, useDeleteHabit, useHabits, useLogHabit, useSaveHabit, type HabitInput } from "./data";
import { completionRate, doneThisWeek, isDone, isScheduled, scheduleLabel, streaks, WEEKDAYS, type DayValues } from "./streaks";

const mod = modules.find((m) => m.id === "habits")!;
const HUE = mod.hue;

function WeekStrip({ habit, values, onToggle }: { habit: Habit; values: DayValues; onToggle: (day: string) => void }) {
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDaysKey(today, i - 6));
  return (
    <div className="flex justify-between gap-1">
      {days.map((day) => {
        const scheduled = isScheduled(habit, day) || habit.schedule.type === "weekly";
        const done = isDone(habit, values.get(day));
        const partial = !done && (values.get(day) ?? 0) > 0;
        return (
          <button
            key={day}
            type="button"
            disabled={day < habit.startDate}
            onClick={() => onToggle(day)}
            aria-label={`${fromKey(day).toDateString()}: ${done ? "done" : "not done"}`}
            className="flex flex-1 flex-col items-center gap-1.5 disabled:opacity-40"
          >
            <span className={cn("text-[11px] font-medium", day === today ? "text-foreground" : "text-muted-foreground")}>
              {WEEKDAYS[(fromKey(day).getDay() + 6) % 7].slice(0, 1)}
            </span>
            <motion.span
              initial={false}
              animate={{ scale: done ? [1, 1.18, 1] : 1 }}
              transition={{ duration: 0.3 }}
              className="size-7 rounded-full transition-colors"
              style={{
                background: done ? habit.color : partial ? `color-mix(in oklch, ${habit.color} 30%, transparent)` : "transparent",
                boxShadow: done ? "none" : `inset 0 0 0 1.5px ${scheduled ? "var(--input)" : "color-mix(in oklch, var(--input) 40%, transparent)"}`,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

function HabitCard({ habit, values, onEdit }: { habit: Habit; values: DayValues; onEdit: (h: Habit) => void }) {
  const log = useLogHabit();
  const archive = useArchiveHabit();
  const remove = useDeleteHabit();
  const [confirm, setConfirm] = useState(false);
  const today = todayKey();
  const value = values.get(today) ?? 0;
  const done = isDone(habit, value);
  const s = streaks(habit, values, today);
  const rate = completionRate(habit, values, today, 30);
  const weekly = habit.schedule.type === "weekly" ? habit.schedule.times : null;
  const set = (v: number, day = today) => log.mutate({ habit, date: day, value: Math.max(0, v) });

  return (
    <article
      className="h-full rounded-2xl border border-border bg-surface p-5 shadow-soft"
      style={{ background: done ? `color-mix(in oklch, ${habit.color} 6%, var(--surface))` : undefined }}
    >
      <div className="flex items-start gap-4">
        {habit.kind === "check" ? (
          <span className="pt-1">
            <CheckCircle checked={done} hue={habit.color} size={34} label={`Mark ${habit.name} done today`} onChange={(v) => set(v ? 1 : 0)} />
          </span>
        ) : (
          <ProgressRing value={value / habit.target} hue={habit.color} size={52} stroke={5}>
            <span className="text-[12px] font-semibold tabular-nums">{value}</span>
          </ProgressRing>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[16px] font-semibold tracking-tight">{habit.name}</h3>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {habit.kind === "count" ? `${habit.target} ${habit.unit ?? ""} · ` : ""}
                {scheduleLabel(habit.schedule)}
                {habit.reminderTime ? (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle">
                    <Bell size={12} /> {habit.reminderTime}
                  </span>
                ) : null}
              </p>
            </div>
            <RowMenu
              items={[
                { label: "Edit", icon: PencilSimple, onSelect: () => onEdit(habit) },
                { label: "Archive", icon: Archive, onSelect: () => archive.mutate(habit.id) },
                { label: "Delete", icon: Trash, danger: true, onSelect: () => setConfirm(true) },
              ]}
            />
          </div>
          {habit.kind === "count" ? (
            <div className="mt-3 flex items-center gap-2">
              <Button size="icon-sm" variant="secondary" aria-label="Less" onClick={() => set(value - 1)} disabled={value <= 0}>
                <Minus />
              </Button>
              <span className="min-w-16 text-center text-[14px] tabular-nums">
                {value} / {habit.target}
              </span>
              <Button size="icon-sm" variant="secondary" aria-label="More" onClick={() => set(value + 1)}>
                <Plus />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <WeekStrip
          habit={habit}
          values={values}
          onToggle={(day) => set(isDone(habit, values.get(day)) ? 0 : habit.kind === "check" ? 1 : habit.target, day)}
        />
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-border/70 pt-3 text-[13px]">
        <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: s.current ? "#e8673a" : undefined }}>
          <Fire size={16} weight={s.current ? "fill" : "regular"} />
          {s.current} {s.unit === "weeks" ? (s.current === 1 ? "week" : "weeks") : s.current === 1 ? "day" : "days"}
        </span>
        <span className="text-muted-foreground">Best {s.best}</span>
        <span className="ml-auto text-muted-foreground">
          {weekly ? `${doneThisWeek(habit, values, today)}/${weekly} this week` : `${Math.round(rate * 100)}% in 30 days`}
        </span>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete "${habit.name}"?`}
        description="Its history is removed too. Archive it instead to keep the history."
        confirmLabel="Delete"
        onConfirm={async () => {
          await remove.mutateAsync(habit.id);
        }}
      />
    </article>
  );
}

function HabitEditor({ habit, open, onClose, defaultColor }: { habit: Habit | null; open: boolean; onClose: () => void; defaultColor: string }) {
  const save = useSaveHabit();
  const [name, setName] = useState(habit?.name ?? "");
  const [color, setColor] = useState(habit?.color ?? defaultColor);
  const [kind, setKind] = useState<Habit["kind"]>(habit?.kind ?? "check");
  const [target, setTarget] = useState(String(habit?.target ?? 8));
  const [unit, setUnit] = useState(habit?.unit ?? "glasses");
  const initial = habit?.schedule ?? { type: "daily" };
  const [scheduleType, setScheduleType] = useState<HabitSchedule["type"]>(initial.type);
  const [days, setDays] = useState<number[]>(initial.type === "weekdays" ? initial.days : [1, 2, 3, 4, 5]);
  const [times, setTimes] = useState(String(initial.type === "weekly" ? initial.times : 3));
  const [reminder, setReminder] = useState(habit?.reminderTime ?? "");

  const schedule: HabitSchedule =
    scheduleType === "daily" ? { type: "daily" } : scheduleType === "weekdays" ? { type: "weekdays", days } : { type: "weekly", times: Math.max(1, Math.min(7, Number(times) || 1)) };
  const valid = name.trim() && (kind === "check" || Number(target) > 0) && (scheduleType !== "weekdays" || days.length);

  async function submit() {
    if (!valid) return;
    const input: HabitInput = {
      name: name.trim(),
      color,
      kind,
      target: kind === "count" ? Number(target) : 1,
      unit: kind === "count" ? unit.trim() || null : null,
      schedule,
      reminderTime: reminder || null,
    };
    await save.mutateAsync({ ...input, id: habit?.id });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{habit ? "Edit habit" : "New habit"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Name" htmlFor="habit-name">
            <Input id="habit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Read 20 pages, drink water, LeetCode daily" autoFocus />
          </Field>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Colour</span>
            <ColorPicker colors={PALETTE} value={color} onChange={setColor} />
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Track as</span>
            <Segmented
              label="Track as"
              value={kind}
              onChange={setKind}
              options={[
                { value: "check", label: "Done / not done" },
                { value: "count", label: "An amount" },
              ]}
            />
          </div>
          {kind === "count" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Daily target" htmlFor="habit-target">
                <Input id="habit-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} />
              </Field>
              <Field label="Unit" htmlFor="habit-unit">
                <Input id="habit-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="glasses, pages, minutes" />
              </Field>
            </div>
          ) : null}
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">How often</span>
            <Segmented
              label="How often"
              value={scheduleType}
              onChange={setScheduleType}
              options={[
                { value: "daily", label: "Daily" },
                { value: "weekdays", label: "Certain days" },
                { value: "weekly", label: "Times a week" },
              ]}
            />
            {scheduleType === "weekdays" ? (
              <PillToggle label="Days" value={days} onChange={setDays} options={WEEKDAYS.map((d, i) => ({ value: i + 1, label: d }))} />
            ) : null}
            {scheduleType === "weekly" ? (
              <div className="flex items-center gap-2 text-[14px]">
                <Input className="w-20" inputMode="numeric" value={times} onChange={(e) => setTimes(e.target.value)} aria-label="Times per week" />
                times a week
              </div>
            ) : null}
          </div>
          <Field label="Reminder (optional)" htmlFor="habit-reminder" hint="Sent only if the habit isn't done yet.">
            <DateTimeInput id="habit-reminder" type="time" value={reminder} onChange={(e) => setReminder(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid} loading={save.isPending}>
            {habit ? "Save" : "Create habit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HabitsPage() {
  const { data, isLoading } = useHabits();
  const [editor, setEditor] = useState<{ open: boolean; habit: Habit | null }>({ open: false, habit: null });
  const today = todayKey();
  const due = data?.habits.filter((hb) => isScheduled(hb, today) || hb.schedule.type === "weekly") ?? [];
  const doneCount = due.filter((hb) => isDone(hb, data!.values.get(hb.id)?.get(today))).length;

  return (
    <Page hue={HUE}>
      <PageHeader
        title="Habits"
        description="Small things, done often."
        icon={mod.icon}
        hue={HUE}
        actions={
          <Button size="sm" onClick={() => setEditor({ open: true, habit: null })}>
            <Plus />
            New habit
          </Button>
        }
      />

      {due.length ? (
        <motion.div variants={rise} className="mt-8 flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-soft">
          <ProgressRing value={doneCount / due.length} hue={HUE} size={64} stroke={7}>
            <span className="text-[14px] font-semibold tabular-nums">
              {doneCount}/{due.length}
            </span>
          </ProgressRing>
          <div>
            <p className="text-[17px] font-semibold tracking-tight">
              {doneCount === due.length ? "All done for today" : `${due.length - doneCount} left today`}
            </p>
            <p className="text-[14px] text-muted-foreground">Tap a day in the week strip to fix a missed check-in.</p>
          </div>
        </motion.div>
      ) : null}

      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-56 rounded-2xl" />
            <Skeleton className="h-56 rounded-2xl" />
          </div>
        ) : !data?.habits.length ? (
          <motion.div variants={rise} className="rounded-2xl border border-border bg-surface shadow-soft">
            <EmptyState
              icon={Target}
              hue={HUE}
              title="No habits yet"
              action={
                <Button onClick={() => setEditor({ open: true, habit: null })}>
                  <Plus />
                  Create your first habit
                </Button>
              }
            >
              Daily, on certain days, or a few times a week. Count things like glasses of water or pages read.
            </EmptyState>
          </motion.div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence initial={false}>
              {data.habits.map((hb) => (
                <motion.div key={hb.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35, ease }}>
                  <HabitCard habit={hb} values={data.values.get(hb.id) ?? new Map()} onEdit={(habit) => setEditor({ open: true, habit })} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <HabitEditor key={`${editor.habit?.id ?? "new"}-${editor.open}`} habit={editor.habit} open={editor.open} defaultColor={PALETTE[[11, 2, 6, 0, 9, 3, 7][(data?.habits.length ?? 0) % 7]]} onClose={() => setEditor({ open: false, habit: null })} />
    </Page>
  );
}
