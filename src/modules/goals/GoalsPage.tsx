import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Archive, ArrowCounterClockwise, CheckFat, Flag, PencilSimple, Plus, Trash, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { CheckCircle, ColorPicker, ConfirmDialog, DateTimeInput, EmptyState, RowMenu, SectionTitle, Textarea } from "@/components/ui/kit";
import type { GoalKind } from "@/core/db/schema";
import { useOpenTarget } from "@/core/shell/openRequest";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { daysBetween, formatLongDate, fromKey, relativeDay, todayKey, type DateKey } from "@/lib/dates";
import { ease, rise } from "@/lib/motion";
import { PALETTE } from "@/lib/palette";
import { cn } from "@/lib/utils";
import { isMinutes, UNITS } from "@/modules/activity/format";
import { useSetDone } from "@/modules/lists/data";
import { modules } from "@/modules/registry";
import {
  useDeleteEntry,
  useDeleteGoal,
  useGoals,
  useGoalStatus,
  useLinkOptions,
  useLogEntry,
  useSaveGoal,
  type GoalView,
} from "./data";
import { goalAmount } from "./format";
import { PACE_LABEL, type Pace, type Point } from "./logic";

const mod = modules.find((m) => m.id === "goals")!;
const HUE = mod.hue;

const PACE_COLOR: Record<Pace, string> = {
  done: "#3fa66b",
  ahead: "#3fa66b",
  on_track: "#3d8bd9",
  behind: "#e8673a",
  overdue: "#e05a5a",
  none: "var(--muted-foreground)",
};

function paceLine(v: GoalView) {
  const p = v.progress;
  if (v.goal.status === "done") return v.goal.completedAt ? `Reached ${relativeDay(todayKeyOf(v.goal.completedAt)).toLowerCase()}` : "Reached";
  if (p.daysLeft === null) return null;
  if (p.daysLeft < 0) return `Was due ${formatLongDate(v.goal.targetDate!)}`;
  const left = p.daysLeft === 0 ? "Due today" : `${p.daysLeft} ${p.daysLeft === 1 ? "day" : "days"} left`;
  if (p.perDay && p.perDay > 0) {
    const per = p.perDay < 1 && p.daysLeft >= 7 ? `${goalAmount(v, p.perDay * 7)} a week` : `${goalAmount(v, p.perDay)} a day`;
    return `${left} · ${per} to make it`;
  }
  return left;
}

const todayKeyOf = (ms: number) => todayKey(new Date(ms));

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

/** Progress over time as a step line, with the planned pace dashed behind it. */
function GoalChart({ v, height = 56, detailed = false }: { v: GoalView; height?: number; detailed?: boolean }) {
  const { goal, progress: p } = v;
  const today = todayKey();
  const end = goal.targetDate && goal.targetDate > today ? goal.targetDate : today;
  const span = Math.max(1, daysBetween(goal.startDate, end));
  const values = [p.start, p.target, ...p.series.map((s) => s.value)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const W = 300;
  const H = height;
  const pad = 4;
  const x = (d: DateKey) => pad + (Math.max(0, daysBetween(goal.startDate, d)) / span) * (W - pad * 2);
  const y = (n: number) => (hi === lo ? H / 2 : H - pad - ((n - lo) / (hi - lo)) * (H - pad * 2));

  // Hold each value until the next point, and to today.
  const pts: Point[] = [{ date: goal.startDate, value: p.start }, ...p.series];
  let d = `M ${x(pts[0].date)} ${y(pts[0].value)}`;
  for (let i = 1; i < pts.length; i++) d += ` H ${x(pts[i].date)} V ${y(pts[i].value)}`;
  d += ` H ${x(goal.status === "done" && p.series.length ? p.series.at(-1)!.date : today)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full overflow-visible" style={{ height }} aria-hidden>
      <line x1={pad} x2={W - pad} y1={y(p.target)} y2={y(p.target)} stroke="var(--border)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
      {goal.targetDate ? (
        <line
          x1={x(goal.startDate)}
          y1={y(p.start)}
          x2={x(goal.targetDate)}
          y2={y(p.target)}
          stroke={goal.color}
          strokeOpacity={0.35}
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <motion.path
        d={d}
        fill="none"
        stroke={goal.color}
        strokeWidth={detailed ? 2.5 : 2}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function GoalCard({ v, onOpen }: { v: GoalView; onOpen: () => void }) {
  const { goal, progress: p } = v;
  const line = paceLine(v);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative h-full w-full overflow-hidden rounded-2xl border border-border bg-surface p-5 text-left shadow-soft transition-transform active:scale-[0.99]"
    >
      <span
        aria-hidden
        className="absolute -right-12 -top-12 size-36 rounded-full opacity-50 blur-2xl"
        style={{ background: `color-mix(in srgb, ${goal.color} 22%, transparent)` }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[16px] font-semibold tracking-tight">{goal.title}</h3>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            {goalAmount(v, p.current)} <span className="opacity-60">of</span> {goalAmount(v, p.target)}
          </p>
        </div>
        {p.pace !== "none" ? (
          <span
            className="shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold"
            style={{ background: `color-mix(in srgb, ${PACE_COLOR[p.pace]} 14%, transparent)`, color: PACE_COLOR[p.pace] }}
          >
            {PACE_LABEL[p.pace]}
          </span>
        ) : null}
      </div>
      <div className="relative mt-4">
        <GoalChart v={v} />
      </div>
      <div className="relative mt-3 h-2 overflow-hidden rounded-full bg-surface-muted">
        <motion.div
          className="h-full rounded-full"
          style={{ background: goal.color }}
          initial={{ width: 0 }}
          animate={{ width: `${p.fraction * 100}%` }}
          transition={{ duration: 0.7, ease }}
        />
      </div>
      <div className="relative mt-2 flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span className="truncate">{line ?? "No end date"}</span>
        <span className="font-semibold tabular-nums text-foreground">{Math.round(p.fraction * 100)}%</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function GoalDetail({ v, onClose, onEdit }: { v: GoalView; onClose: () => void; onEdit: () => void }) {
  const { goal, progress: p } = v;
  const client = useQueryClient();
  const status = useGoalStatus();
  const remove = useDeleteGoal();
  const log = useLogEntry();
  const unlog = useDeleteEntry();
  const setDone = useSetDone();
  const [value, setValue] = useState("");
  const [date, setDate] = useState(todayKey());
  const [confirm, setConfirm] = useState(false);
  const line = paceLine(v);

  async function addEntry() {
    const n = Number(value);
    if (!value.trim() || Number.isNaN(n)) return;
    await log.mutateAsync({ goalId: goal.id, date, value: n });
    setValue("");
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-6">
            <span className="size-3 shrink-0 rounded-full" style={{ background: goal.color }} />
            <DialogTitle className="truncate">{goal.title}</DialogTitle>
            <span className="ml-auto">
              <RowMenu
                items={[
                  { label: "Edit", icon: PencilSimple, onSelect: onEdit },
                  ...(goal.status === "done" ? [] : [{ label: "Mark reached", icon: CheckFat, onSelect: () => status.mutate({ id: goal.id, status: "done" }) }]),
                  goal.status === "archived"
                    ? { label: "Unarchive", icon: ArrowCounterClockwise, onSelect: () => status.mutate({ id: goal.id, status: "active" }) }
                    : { label: "Archive", icon: Archive, onSelect: () => status.mutate({ id: goal.id, status: "archived" }) },
                  { label: "Delete", icon: Trash, danger: true, onSelect: () => setConfirm(true) },
                ]}
              />
            </span>
          </div>
          {goal.notes ? <DialogDescription className="whitespace-pre-wrap">{goal.notes}</DialogDescription> : null}
        </DialogHeader>

        <div className="grid gap-1">
          <div className="flex items-end justify-between gap-3">
            <p className="text-[28px] font-semibold leading-none tracking-tight tabular-nums">{Math.round(p.fraction * 100)}%</p>
            {p.pace !== "none" ? (
              <span className="text-[13px] font-semibold" style={{ color: PACE_COLOR[p.pace] }}>
                {PACE_LABEL[p.pace]}
              </span>
            ) : null}
          </div>
          <p className="text-[14px] text-muted-foreground">
            {goalAmount(v, p.current)} of {goalAmount(v, p.target)}
            {goal.kind === "manual" ? ` (started at ${goalAmount(v, p.start)})` : ""}
          </p>
          <div className="mt-3">
            <GoalChart v={v} height={120} detailed />
            <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
              <span>{fromKey(goal.startDate).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
              <span>{goal.targetDate ? fromKey(goal.targetDate).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" }) : "Today"}</span>
            </div>
          </div>
          {line ? <p className="mt-2 text-[13px] text-muted-foreground">{line}</p> : null}
          {p.expected !== null && goal.status === "active" && p.pace !== "overdue" ? (
            <p className="text-[13px] text-muted-foreground">Planned pace for today: {goalAmount(v, p.expected)}</p>
          ) : null}
        </div>

        {goal.kind === "manual" ? (
          <section className="grid gap-3">
            <SectionTitle>Log a value</SectionTitle>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void addEntry();
              }}
            >
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={goal.unit ?? "Value"} aria-label="Value" className="flex-1" />
              <DateTimeInput type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} aria-label="Date" className="w-40" />
              <Button type="submit" disabled={!value.trim()} loading={log.isPending}>
                Log
              </Button>
            </form>
            {v.entries.length ? (
              <ul className="grid max-h-48 gap-1 overflow-y-auto">
                {[...v.entries].reverse().map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-[14px] hover:bg-surface-muted">
                    <span className="text-muted-foreground">{relativeDay(e.date)}</span>
                    <span className="ml-auto font-medium tabular-nums">{goalAmount(v, e.value)}</span>
                    <button type="button" aria-label="Remove entry" onClick={() => unlog.mutate(e.id)} className="rounded p-1 text-muted-foreground hover:text-danger">
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {v.tasks.length ? (
          <section>
            <SectionTitle>Tasks</SectionTitle>
            <ul className="grid gap-1">
              {v.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
                  <CheckCircle
                    checked={t.status === "done"}
                    hue={goal.color}
                    label={`Mark ${t.title} done`}
                    onChange={async (done) => {
                      await setDone.mutateAsync({ task: t, done });
                      await client.invalidateQueries({ queryKey: ["goals"] });
                    }}
                  />
                  <span className={cn("text-[14px]", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span>
                  {t.dueDate ? <span className="ml-auto text-[12px] text-muted-foreground">{relativeDay(t.dueDate)}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {v.habits.length ? (
          <section>
            <SectionTitle>Habits</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {v.habits.map((h) => (
                <span key={h.id} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-3 text-[13px] font-medium">
                  <span className="size-2 rounded-full" style={{ background: h.color }} />
                  {h.name}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <ConfirmDialog
          open={confirm}
          onOpenChange={setConfirm}
          title={`Delete "${goal.title}"?`}
          description="Its logged values go too. Archive it instead to keep them."
          confirmLabel="Delete"
          onConfirm={async () => {
            await remove.mutateAsync(goal.id);
            onClose();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export interface GoalDraft {
  title?: string;
  notes?: string;
}

const KIND_HELP: Record<GoalKind, string> = {
  manual: "A number you update yourself, like a rating, a lift or your weight.",
  activity: "Counts what you already track: focus time, problems solved, books read…",
  habits: "Check-ins of the habits it is made of.",
  tasks: "Done when its tasks are done.",
};

function GoalEditor({ v, draft, onClose, defaultColor }: { v: GoalView | null; draft?: GoalDraft; onClose: () => void; defaultColor: string }) {
  const goal = v?.goal;
  const save = useSaveGoal();
  const options = useLinkOptions(true);
  const [title, setTitle] = useState(goal?.title ?? draft?.title ?? "");
  const [notes, setNotes] = useState(goal?.notes ?? draft?.notes ?? "");
  const [color, setColor] = useState(goal?.color ?? defaultColor);
  const [kind, setKind] = useState<GoalKind>(goal?.kind ?? "activity");
  const [activityType, setActivityType] = useState(goal?.activityType ?? "focus");
  const [activityTag, setActivityTag] = useState(goal?.activityTag ?? "");
  const minutes = isMinutes(activityType);
  const initialTarget = goal ? (goal.kind === "activity" && isMinutes(goal.activityType ?? "") ? goal.targetValue / 60 : goal.targetValue) : null;
  const [target, setTarget] = useState(initialTarget !== null ? String(initialTarget) : "");
  const [start, setStart] = useState(goal ? String(goal.startValue) : "");
  const [unit, setUnit] = useState(goal?.unit ?? "");
  const [startDate, setStartDate] = useState(goal?.startDate ?? todayKey());
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? "");
  const [habitIds, setHabitIds] = useState<string[]>(v?.links.filter((l) => l.kind === "habit").map((l) => l.refId) ?? []);
  const [taskIds, setTaskIds] = useState<string[]>(v?.links.filter((l) => l.kind === "task").map((l) => l.refId) ?? []);

  const openTasks = useMemo(
    () => (options.data?.tasks ?? []).filter((t) => t.status !== "done" || taskIds.includes(t.id)).sort((a, b) => a.title.localeCompare(b.title)),
    [options.data, taskIds],
  );
  const targetNumber = Number(target);
  const valid =
    title.trim() &&
    (kind === "tasks" ? taskIds.length > 0 : target.trim() !== "" && !Number.isNaN(targetNumber)) &&
    (kind !== "manual" || (start.trim() !== "" && !Number.isNaN(Number(start)) && Number(start) !== targetNumber)) &&
    (kind !== "activity" || targetNumber > 0) &&
    (kind !== "habits" || (habitIds.length > 0 && targetNumber > 0)) &&
    (!targetDate || targetDate > startDate);

  async function submit() {
    if (!valid) return;
    const targetValue = kind === "tasks" ? taskIds.length : kind === "activity" && minutes ? targetNumber * 60 : targetNumber;
    // A reached goal given a new target is back in progress; the goal check closes it again if it is still met.
    const retargeted = goal?.status === "done" && (goal.kind !== kind || goal.targetValue !== targetValue || goal.startDate !== startDate);
    await save.mutateAsync({
      id: goal?.id,
      reopen: retargeted,
      title: title.trim(),
      notes: notes.trim() || null,
      kind,
      unit: kind === "manual" ? unit.trim() || null : null,
      startValue: kind === "manual" ? Number(start) : 0,
      targetValue,
      startDate,
      targetDate: targetDate || null,
      activityType: kind === "activity" ? activityType : null,
      activityTag: kind === "activity" && activityTag ? activityTag : null,
      color,
      habitIds: kind === "habits" ? habitIds : [],
      taskIds: kind === "tasks" ? taskIds : [],
    });
    onClose();
  }

  const typeUnit = minutes ? "hours" : UNITS[activityType] ?? "";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{goal ? "Edit goal" : "New goal"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Goal" htmlFor="goal-title">
            <Input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Reach CF Expert, 100 hours of focus, finish the OS course" autoFocus />
          </Field>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Track progress by</span>
            <Segmented
              label="Track progress by"
              value={kind}
              onChange={setKind}
              className="w-full"
              options={[
                { value: "activity", label: "Activity" },
                { value: "manual", label: "A number" },
                { value: "habits", label: "Habits" },
                { value: "tasks", label: "Tasks" },
              ]}
            />
            <p className="text-[13px] text-muted-foreground">{KIND_HELP[kind]}</p>
          </div>

          {kind === "activity" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="What counts" htmlFor="goal-type">
                <NativeSelect id="goal-type" className="h-11 w-full text-[14px]" value={activityType} onChange={(e) => setActivityType(e.target.value)}>
                  {(options.data?.types ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label={`Target (${typeUnit})`} htmlFor="goal-target">
                <Input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder={minutes ? "100" : "300"} />
              </Field>
              {options.data?.tags.length && (activityType === "focus" || activityType === "tasks") ? (
                <Field label="Only with tag (optional)" htmlFor="goal-tag">
                  <NativeSelect id="goal-tag" className="h-11 w-full text-[14px]" value={activityTag} onChange={(e) => setActivityTag(e.target.value)}>
                    <option value="">Any</option>
                    {options.data.tags.map((t) => (
                      <option key={t} value={t}>
                        #{t}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              ) : null}
            </div>
          ) : null}

          {kind === "manual" ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Now" htmlFor="goal-start">
                <Input id="goal-start" inputMode="decimal" value={start} onChange={(e) => setStart(e.target.value)} placeholder="1420" />
              </Field>
              <Field label="Target" htmlFor="goal-target">
                <Input id="goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="1600" />
              </Field>
              <Field label="Unit" htmlFor="goal-unit">
                <Input id="goal-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="rating, kg" />
              </Field>
            </div>
          ) : null}

          {kind === "habits" ? (
            <div className="grid gap-3">
              {options.data?.habits.length ? (
                <HabitPicker habits={options.data.habits} value={habitIds} onChange={setHabitIds} />
              ) : (
                <p className="text-[13px] text-muted-foreground">Create a habit first, then link it here.</p>
              )}
              <Field label="Target check-ins" htmlFor="goal-target" hint="Each day a linked habit is done counts once.">
                <Input id="goal-target" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="100" />
              </Field>
            </div>
          ) : null}

          {kind === "tasks" ? (
            openTasks.length ? (
              <div className="grid max-h-56 gap-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
                {openTasks.map((t) => {
                  const on = taskIds.includes(t.id);
                  return (
                    <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-[14px] hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => setTaskIds(on ? taskIds.filter((x) => x !== t.id) : [...taskIds, t.id])}
                        className="size-4 accent-[var(--accent)]"
                      />
                      <span className={cn("truncate", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">Add the tasks in Lists first, then link them here.</p>
            )
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Counting from" htmlFor="goal-start-date">
              <DateTimeInput id="goal-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || todayKey())} />
            </Field>
            <Field label="Finish by (optional)" htmlFor="goal-target-date">
              <DateTimeInput id="goal-target-date" type="date" value={targetDate} min={startDate} onChange={(e) => setTargetDate(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Colour</span>
            <ColorPicker colors={PALETTE} value={color} onChange={setColor} />
          </div>
          <Field label="Why it matters (optional)" htmlFor="goal-notes">
            <Textarea id="goal-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid} loading={save.isPending}>
            {goal ? "Save" : "Create goal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HabitPicker({ habits, value, onChange }: { habits: { id: string; name: string; color: string }[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div role="group" aria-label="Habits" className="flex flex-wrap gap-1.5">
      {habits.map((h) => {
        const on = value.includes(h.id);
        return (
          <button
            key={h.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== h.id) : [...value, h.id])}
            className={cn("flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-95", on ? "border-transparent" : "border-border text-muted-foreground")}
            style={on ? { background: `color-mix(in srgb, ${h.color} 18%, transparent)`, color: `color-mix(in srgb, ${h.color} 80%, var(--foreground))` } : undefined}
          >
            <span className="size-2 rounded-full" style={{ background: on ? h.color : "var(--muted-foreground)" }} />
            {h.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Filter = "active" | "done" | "archived";

export function GoalsPage() {
  const { data, isLoading } = useGoals();
  const [filter, setFilter] = useState<Filter>("active");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ id: string | null; draft?: GoalDraft } | null>(null);

  useOpenTarget(["goals"], !!data, ({ id, draft }) => {
    if (id === "new") setEditor({ id: null, draft });
    else setOpenId(id);
  });

  const counts = { active: 0, done: 0, archived: 0 };
  for (const v of data ?? []) counts[v.goal.status]++;
  const shown = (data ?? []).filter((v) => v.goal.status === filter);
  const opened = data?.find((v) => v.goal.id === openId) ?? null;
  const editing = editor?.id ? (data?.find((v) => v.goal.id === editor.id) ?? null) : null;

  return (
    <Page hue={HUE}>
      <PageHeader
        title="Goals"
        description="Longer targets, tracked from everything else."
        icon={mod.icon}
        hue={HUE}
        actions={
          <Button size="sm" onClick={() => setEditor({ id: null })}>
            <Plus />
            New goal
          </Button>
        }
      />

      {data?.length ? (
        <motion.div variants={rise} className="mt-8">
          <Segmented
            label="Show"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "active", label: `Active${counts.active ? ` ${counts.active}` : ""}` },
              { value: "done", label: `Reached${counts.done ? ` ${counts.done}` : ""}` },
              { value: "archived", label: `Archived${counts.archived ? ` ${counts.archived}` : ""}` },
            ]}
          />
        </motion.div>
      ) : null}

      <div className="mt-6">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        ) : !data?.length ? (
          <motion.div variants={rise} className="rounded-2xl border border-border bg-surface shadow-soft">
            <EmptyState
              icon={Flag}
              hue={HUE}
              title="No goals yet"
              action={
                <Button onClick={() => setEditor({ id: null })}>
                  <Plus />
                  Set your first goal
                </Button>
              }
            >
              Track a number you update, like a rating, or let it fill itself from focus time, problems solved, habits or tasks.
            </EmptyState>
          </motion.div>
        ) : !shown.length ? (
          <p className="py-12 text-center text-[14px] text-muted-foreground">
            {filter === "done" ? "No goals reached yet." : filter === "archived" ? "Nothing archived." : "No active goals."}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <AnimatePresence initial={false}>
              {shown.map((v) => (
                <motion.div key={v.goal.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.35, ease }}>
                  <GoalCard v={v} onOpen={() => setOpenId(v.goal.id)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {opened ? (
        <GoalDetail
          v={opened}
          onClose={() => setOpenId(null)}
          onEdit={() => {
            setOpenId(null);
            setEditor({ id: opened.goal.id });
          }}
        />
      ) : null}
      {editor ? (
        <GoalEditor
          key={editor.id ?? "new"}
          v={editing}
          draft={editor.draft}
          defaultColor={PALETTE[[4, 1, 8, 11, 6, 2][(data?.length ?? 0) % 6]]}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </Page>
  );
}
