import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowDown, ArrowLeft, ArrowUp, Check, CopySimple, Plus, Timer, Trash, Trophy } from "@phosphor-icons/react";
import { DropdownMenu as Menu } from "radix-ui";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ConfirmDialog, DateTimeInput, RowMenu, Textarea } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import type { Exercise, Workout, WorkoutSet } from "@/core/db/schema";
import { Page } from "@/core/shell/PageHeader";
import { formatLongDate, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { modules, pathOf } from "@/modules/registry";
import {
  useAddExercises,
  useAddSet,
  useDeleteWorkout,
  useFinishWorkout,
  useGym,
  useMoveExercise,
  useRemoveExercise,
  useRemoveSet,
  useSaveTemplate,
  useUnit,
  useUpdateSet,
  useUpdateWorkout,
  type GymData,
} from "./data";
import { ExercisePicker } from "./Dialogs";
import { describeSet, formatDuration, formatRecord, formatSeconds, formatVolume, fromUnit, isWorking, muscleName, previousSets, recordLabelInline, toUnit, workoutRecords, type NewRecord, type Unit } from "./logic";
import { RestBar } from "./rest";
import { useRest } from "./restStore";

const HUE = modules.find((m) => m.id === "fitness")!.hue;

/** A typed number, kept as text while editing. */
function Cell({ value, onCommit, placeholder, label, className }: { value: number | null; onCommit: (v: number | null) => void; placeholder?: string; label: string; className?: string }) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const [last, setLast] = useState(value);
  // Follow outside changes (another device, a filled-in set) when not editing.
  if (value !== last) {
    setLast(value);
    setText(value === null ? "" : String(value));
  }
  const commit = () => {
    const t = text.replace(",", ".").trim();
    const n = t === "" ? null : Number(t);
    if (n !== null && !Number.isFinite(n)) return setText(value === null ? "" : String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onFocus={(e) => e.target.select()}
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-transparent bg-surface-muted px-1 text-center text-[15px] font-medium tabular-nums outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring focus:bg-surface",
        className,
      )}
    />
  );
}

interface Columns {
  /** First input: weight (in the display unit), seconds, minutes. */
  a: { label: string; get: (s: WorkoutSet) => number | null; set: (v: number | null) => Partial<WorkoutSet> } | null;
  b: { label: string; get: (s: WorkoutSet) => number | null; set: (v: number | null) => Partial<WorkoutSet> };
}

function columnsFor(e: Exercise, unit: Unit): Columns {
  const weight = { label: unit, get: (s: WorkoutSet) => (s.weight === null ? null : toUnit(s.weight, unit)), set: (v: number | null) => ({ weight: v === null ? null : Math.round(fromUnit(v, unit) * 1000) / 1000 }) };
  const reps = { label: "Reps", get: (s: WorkoutSet) => s.reps, set: (v: number | null) => ({ reps: v === null ? null : Math.round(v) }) };
  switch (e.measure) {
    case "weight":
      return { a: weight, b: reps };
    case "reps":
      return { a: { ...weight, label: `+${unit}` }, b: reps };
    case "time":
      return { a: null, b: { label: "Sec", get: (s) => s.seconds, set: (v) => ({ seconds: v === null ? null : Math.round(v) }) } };
    case "cardio":
      return {
        a: { label: "Min", get: (s) => (s.seconds === null ? null : Math.round((s.seconds / 60) * 10) / 10), set: (v) => ({ seconds: v === null ? null : Math.round(v * 60) }) },
        b: { label: "Km", get: (s) => s.distance, set: (v) => ({ distance: v }) },
      };
  }
}

function SetMenu({ set, number, onWarmup, onRemove }: { set: WorkoutSet; number: number; onWarmup: () => void; onRemove: () => void }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          type="button"
          aria-label={`Set ${number} options`}
          className={cn("grid h-9 w-full place-items-center rounded-lg text-[13px] font-semibold tabular-nums transition-colors hover:bg-surface-muted", set.warmup ? "text-amber-500" : "text-muted-foreground")}
        >
          {set.warmup ? "W" : number}
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content align="start" sideOffset={4} className="z-50 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-float">
          <Menu.Item onSelect={onWarmup} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] outline-none data-[highlighted]:bg-surface-muted">
            {set.warmup ? "Make a working set" : "Mark as warm-up"}
          </Menu.Item>
          <Menu.Item onSelect={onRemove} className="flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] text-danger outline-none data-[highlighted]:bg-surface-muted">
            <Trash size={16} />
            Remove set
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

function ExerciseBlock({
  workout,
  exercise,
  position,
  sets,
  data,
  records,
  first,
  last,
}: {
  workout: Workout;
  exercise: Exercise;
  position: number;
  sets: WorkoutSet[];
  data: GymData;
  records: NewRecord[];
  first: boolean;
  last: boolean;
}) {
  const unit = useUnit();
  const [restSeconds] = usePref("gym.rest");
  const update = useUpdateSet();
  const addSet = useAddSet();
  const removeSet = useRemoveSet();
  const removeExercise = useRemoveExercise();
  const move = useMoveExercise();
  const startRest = useRest((s) => s.start);
  const cols = columnsFor(exercise, unit);
  const prev = useMemo(() => previousSets(exercise.id, data.sets, data.workouts, workout.startedAt, workout.id), [exercise.id, data, workout]);
  // Ticking sets off is for live workouts; in a finished one every set counts.
  const live = !workout.endedAt;
  const grid = cols.a
    ? live
      ? "grid-cols-[32px_minmax(0,1fr)_64px_56px_44px_40px]"
      : "grid-cols-[32px_minmax(0,1fr)_64px_56px_44px]"
    : live
      ? "grid-cols-[32px_minmax(0,1fr)_88px_44px_40px]"
      : "grid-cols-[32px_minmax(0,1fr)_88px_44px]";
  let working = 0;

  const patch = (s: WorkoutSet, p: Partial<WorkoutSet>) => update.mutate({ id: s.id, workoutId: workout.id, patch: p });

  return (
    <motion.section variants={rise} className="rounded-2xl border border-border bg-surface p-3 shadow-soft md:p-4">
      <div className="mb-2 flex items-start gap-2 px-1">
        <Link to="/fitness/exercises" search={{ e: exercise.id }} className="grid min-w-0 flex-1">
          <span className="truncate text-[15px] font-semibold tracking-tight" style={{ color: HUE }}>
            {exercise.name}
          </span>
          <span className="truncate text-[12px] capitalize text-muted-foreground">
            {muscleName(exercise.muscle)} · {exercise.equipment}
          </span>
        </Link>
        <RowMenu
          items={[
            ...(first ? [] : [{ label: "Move up", icon: ArrowUp, onSelect: () => move.mutate({ workoutId: workout.id, position, by: -1 }) }]),
            ...(last ? [] : [{ label: "Move down", icon: ArrowDown, onSelect: () => move.mutate({ workoutId: workout.id, position, by: 1 }) }]),
            { label: "Remove exercise", icon: Trash, danger: true, onSelect: () => removeExercise.mutate({ workoutId: workout.id, position }) },
          ]}
        />
      </div>
      <div className={cn("grid items-center gap-1.5 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground", grid)}>
        <span className="text-center">Set</span>
        <span>Previous</span>
        {cols.a ? <span className="text-center">{cols.a.label}</span> : null}
        <span className="text-center">{cols.b.label}</span>
        <span className="text-center">RPE</span>
        {live ? <span className="sr-only">Done</span> : null}
      </div>
      <ul className="grid gap-1">
        {sets.map((s) => {
          if (!s.warmup) working++;
          const p = prev.filter((x) => x.warmup === s.warmup)[s.warmup ? 0 : working - 1];
          const pr = records.find((r) => r.setId === s.id);
          return (
            <li key={s.id} className={cn("grid items-center gap-1.5 rounded-xl px-1 py-0.5 transition-colors", grid, live && s.done && "bg-[color-mix(in_srgb,var(--success)_10%,transparent)]")}>
              <span className="relative">
                <SetMenu set={s} number={working} onWarmup={() => patch(s, { warmup: !s.warmup })} onRemove={() => removeSet.mutate({ id: s.id, workoutId: workout.id })} />
                {/* Finished workouts have no tick to carry the record badge. */}
                {pr && !live ? (
                  <span className="pointer-events-none absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-amber-500 text-white ring-2 ring-surface" title={`Record: ${recordLabelInline(pr.kind)}`}>
                    <Trophy size={10} weight="fill" />
                  </span>
                ) : null}
              </span>
              <span className="truncate text-[12px] text-muted-foreground">{p ? describeSet(p, exercise.measure, unit) : "–"}</span>
              {cols.a ? <Cell label={cols.a.label} value={cols.a.get(s)} placeholder={p ? String(cols.a.get(p) ?? "") : ""} onCommit={(v) => patch(s, cols.a!.set(v))} /> : null}
              <Cell label={cols.b.label} value={cols.b.get(s)} placeholder={p ? String(cols.b.get(p) ?? "") : ""} onCommit={(v) => patch(s, cols.b.set(v))} />
              <Cell label="RPE" value={s.rpe} placeholder="–" onCommit={(v) => patch(s, { rpe: v === null ? null : Math.min(10, Math.max(1, v)) })} className="text-[13px]" />
              {live ? (
              <button
                type="button"
                aria-label={s.done ? "Mark not done" : "Mark done"}
                aria-pressed={s.done}
                onClick={() => {
                  // Ticking an empty set takes last time's numbers.
                  const fill: Partial<WorkoutSet> = {};
                  if (!s.done && p) {
                    if (s.weight === null && p.weight !== null) fill.weight = p.weight;
                    if (s.reps === null && p.reps !== null) fill.reps = p.reps;
                    if (s.seconds === null && p.seconds !== null) fill.seconds = p.seconds;
                    if (s.distance === null && p.distance !== null) fill.distance = p.distance;
                  }
                  patch(s, { ...fill, done: !s.done });
                  if (!s.done && !workout.endedAt) startRest(restSeconds);
                }}
                className={cn("relative grid size-9 place-items-center rounded-lg border transition-colors active:scale-95", s.done ? "border-transparent bg-success text-white" : "border-border text-muted-foreground hover:bg-surface-muted")}
              >
                <Check size={18} weight="bold" />
                {pr ? (
                  <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-amber-500 text-white ring-2 ring-surface" title={`Record: ${recordLabelInline(pr.kind)}`}>
                    <Trophy size={10} weight="fill" />
                  </span>
                ) : null}
              </button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => addSet.mutate({ workoutId: workout.id, exerciseId: exercise.id, position })}>
        <Plus />
        Add set
      </Button>
    </motion.section>
  );
}

function FinishDialog({ workout, data, records, onClose }: { workout: Workout; data: GymData; records: NewRecord[]; onClose: () => void }) {
  const finish = useFinishWorkout();
  const navigate = useNavigate();
  const unit = useUnit();
  const stop = useRest((s) => s.stop);
  const sets = data.sets.filter((s) => s.workoutId === workout.id);
  const done = sets.filter((s) => s.done);
  const skipped = sets.length - done.length;
  const volume = sets.filter(isWorking).reduce((n, s) => n + (s.weight ?? 0) * (s.reps ?? 0), 0);
  const [openedAt] = useState(() => Date.now());

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Finish workout?</DialogTitle>
          <DialogDescription>
            {done.length ? `${done.length} ${done.length === 1 ? "set" : "sets"} in ${formatDuration(openedAt - workout.startedAt)}.` : "No sets are ticked yet."}
            {skipped ? ` ${skipped} unticked ${skipped === 1 ? "set is" : "sets are"} dropped.` : ""}
          </DialogDescription>
        </DialogHeader>
        {done.length ? (
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-surface-muted px-3 py-2">
                <p className="text-[12px] text-muted-foreground">Volume</p>
                <p className="text-[18px] font-semibold tabular-nums">{formatVolume(volume, unit)}</p>
              </div>
              <div className="rounded-xl bg-surface-muted px-3 py-2">
                <p className="text-[12px] text-muted-foreground">Records</p>
                <p className="text-[18px] font-semibold tabular-nums">{records.length}</p>
              </div>
            </div>
            {records.length ? (
              <ul className="grid gap-1">
                {records.map((r) => (
                  <li key={`${r.exerciseId}-${r.kind}`} className="flex items-center gap-2 text-[13px]">
                    <Trophy size={14} weight="fill" className="text-amber-500" />
                    <span className="min-w-0 flex-1 truncate">
                      {data.byId.get(r.exerciseId)?.name} · {recordLabelInline(r.kind)}
                    </span>
                    <span className="font-medium tabular-nums">{formatRecord(r.kind, r.value, unit)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Keep going
          </Button>
          <Button
            disabled={!done.length}
            loading={finish.isPending}
            onClick={async () => {
              await finish.mutateAsync(workout.id);
              stop();
              toast.success(records.length ? `Workout saved, ${records.length} new ${records.length === 1 ? "record" : "records"}` : "Workout saved");
              void navigate({ to: pathOf("fitness") });
            }}
          >
            Finish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailsDialog({ workout, onClose }: { workout: Workout; onClose: () => void }) {
  const update = useUpdateWorkout();
  const [date, setDate] = useState(workout.date);
  const [minutes, setMinutes] = useState(() => String(Math.round(((workout.endedAt ?? Date.now()) - workout.startedAt) / 60_000)));
  const mins = Math.round(Number(minutes));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Date and length</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="wo-date">
            <DateTimeInput id="wo-date" type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || workout.date)} />
          </Field>
          <Field label="Minutes" htmlFor="wo-minutes">
            <Input id="wo-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!(mins > 0)}
            onClick={async () => {
              const startedAt = date === workout.date ? workout.startedAt : new Date(`${date}T18:00:00`).getTime();
              await update.mutateAsync({ id: workout.id, patch: { date, startedAt, endedAt: startedAt + mins * 60_000 } });
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Logging a workout live, or editing a finished one. */
export function WorkoutPage() {
  const { w } = useSearch({ from: "/fitness/workout" });
  const navigate = useNavigate();
  const { data, isLoading } = useGym();
  const unit = useUnit();
  const update = useUpdateWorkout();
  const addExercises = useAddExercises();
  const remove = useDeleteWorkout();
  const saveTemplate = useSaveTemplate();
  const stopRest = useRest((s) => s.stop);
  const now = useNow(1000).getTime();
  const [picking, setPicking] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [details, setDetails] = useState(false);

  const workout = data?.workouts.find((x) => x.id === w);
  const sets = useMemo(() => (data && workout ? data.sets.filter((s) => s.workoutId === workout.id) : []), [data, workout]);
  const blocks = useMemo(() => {
    const out = new Map<number, WorkoutSet[]>();
    for (const s of sets) out.set(s.position, [...(out.get(s.position) ?? []), s]);
    return [...out].sort((a, b) => a[0] - b[0]);
  }, [sets]);
  const records = useMemo(() => (data && workout ? workoutRecords(workout, data.sets, data.workouts, data.byId) : []), [data, workout]);

  if (isLoading || !data) {
    return (
      <div className="mx-auto grid max-w-[760px] gap-4 px-4 py-8">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );
  }
  if (!workout) {
    return (
      <div className="mx-auto grid max-w-[760px] justify-items-center gap-3 px-4 py-20 text-center">
        <p className="text-[15px] text-muted-foreground">This workout no longer exists.</p>
        <Button asChild variant="secondary">
          <Link to={pathOf("fitness")}>Back to Gym</Link>
        </Button>
      </div>
    );
  }

  const live = !workout.endedAt;
  const done = sets.filter((s) => s.done).length;
  const elapsed = (workout.endedAt ?? now) - workout.startedAt;

  return (
    <Page hue={HUE} className="max-w-[760px] pb-32">
      <div className="grid gap-4">
        <motion.div variants={rise} className="flex items-center justify-between gap-2">
          <Link to={pathOf("fitness")} className="flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
            Gym
          </Link>
          <div className="flex items-center gap-1">
            <RowMenu
              items={[
                {
                  label: "Save as routine",
                  icon: CopySimple,
                  onSelect: async () => {
                    const exercises = blocks.map(([, list]) => ({ exerciseId: list[0]!.exerciseId, sets: list.filter((s) => !s.warmup).length || list.length, reps: list.find((s) => !s.warmup)?.reps ?? null }));
                    await saveTemplate.mutateAsync({ name: workout.name, notes: null, exercises });
                    toast.success(`Saved "${workout.name}" as a routine`);
                  },
                },
                ...(live ? [] : [{ label: "Date and length", icon: Timer, onSelect: () => setDetails(true) }]),
                { label: live ? "Discard workout" : "Delete workout", icon: Trash, danger: true, onSelect: () => setDiscarding(true) },
              ]}
            />
            {live ? (
              <Button size="sm" onClick={() => setFinishing(true)}>
                <Check />
                Finish
              </Button>
            ) : null}
          </div>
        </motion.div>

        <motion.header variants={rise} className="relative overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
          <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${HUE} 14%, transparent), transparent 60%)` }} />
          <div className="relative grid gap-2">
            <input
              aria-label="Workout name"
              defaultValue={workout.name}
              key={workout.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== workout.name) update.mutate({ id: workout.id, patch: { name } });
                else e.target.value = workout.name;
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className="w-full bg-transparent text-[24px] font-semibold tracking-tight outline-none md:text-[28px]"
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span className={cn("flex items-center gap-1 tabular-nums", live && "font-semibold text-foreground")}>
                <Timer size={14} />
                {live ? formatSeconds(Math.floor(elapsed / 1000)) : formatDuration(elapsed)}
              </span>
              <span>{live ? "In progress" : formatLongDate(workout.date)}</span>
              <span className="tabular-nums" title="Weight × reps over working sets">
                {formatVolume(workout.volume, unit)} lifted
              </span>
              <span className="tabular-nums">
                {live ? `${done} of ${sets.length} sets done` : `${sets.filter((x) => !x.warmup).length} ${sets.filter((x) => !x.warmup).length === 1 ? "set" : "sets"}`}
              </span>
              {records.length ? (
                <span className="flex items-center gap-1 font-medium text-foreground">
                  <Trophy size={14} weight="fill" className="text-amber-500" />
                  {records.length} {records.length === 1 ? "record" : "records"}
                </span>
              ) : null}
            </div>
          </div>
        </motion.header>

        {blocks.map(([position, list], i) => {
          const exercise = data.byId.get(list[0]!.exerciseId);
          if (!exercise) return null;
          return (
            <ExerciseBlock
              key={`${position}-${exercise.id}`}
              workout={workout}
              exercise={exercise}
              position={position}
              sets={list}
              data={data}
              records={records.filter((r) => r.exerciseId === exercise.id)}
              first={i === 0}
              last={i === blocks.length - 1}
            />
          );
        })}

        {!blocks.length ? (
          <motion.p variants={rise} className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-[14px] text-muted-foreground">
            Add the exercises you are doing; each starts with your sets from last time.
          </motion.p>
        ) : null}

        <motion.div variants={rise}>
          <Button variant="secondary" className="w-full" onClick={() => setPicking(true)}>
            <Plus />
            Add exercises
          </Button>
        </motion.div>

        <motion.div variants={rise}>
          <Textarea
            aria-label="Workout notes"
            rows={2}
            placeholder="Notes: how it felt, what to change next time"
            defaultValue={workout.notes ?? ""}
            onBlur={(e) => {
              const notes = e.target.value.trim() || null;
              if (notes !== workout.notes) update.mutate({ id: workout.id, patch: { notes } });
            }}
          />
        </motion.div>
      </div>

      <RestBar hue={HUE} />
      {picking ? (
        <ExercisePicker
          exercises={data.exercises}
          onClose={() => setPicking(false)}
          onPick={async (ids) => {
            setPicking(false);
            await addExercises.mutateAsync({ workoutId: workout.id, exerciseIds: ids });
          }}
        />
      ) : null}
      {finishing ? <FinishDialog workout={workout} data={data} records={records} onClose={() => setFinishing(false)} /> : null}
      {details ? <DetailsDialog workout={workout} onClose={() => setDetails(false)} /> : null}
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title={live ? "Discard this workout?" : "Delete this workout?"}
        description="Its sets go too, and it leaves the heatmap."
        confirmLabel={live ? "Discard" : "Delete"}
        onConfirm={async () => {
          await remove.mutateAsync(workout.id);
          stopRest();
          void navigate({ to: pathOf("fitness") });
        }}
      />
    </Page>
  );
}

