import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, MagnifyingGlass, Plus, Trash, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DateTimeInput, Textarea } from "@/components/ui/kit";
import type { BodyMetric, Exercise, Measure, Muscle, TemplateItem, WorkoutTemplate } from "@/core/db/schema";
import { addDaysKey, todayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useDeleteExercise, useDeleteMetric, useDeleteTemplate, useLogPastWorkout, useSaveExercise, useSaveMetric, useSaveTemplate, useUnit, type MetricInput } from "./data";
import { EQUIPMENT, fromUnit, MEASUREMENTS, MEASURES, MUSCLES, muscleName, toUnit } from "./logic";

/** A number field that keeps what is typed and reports a number (or null). */
function NumberInput({ value, onChange, ...props }: { value: number | null; onChange: (v: number | null) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <Input
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(",", ".");
        setText(t);
        const n = Number(t);
        onChange(t.trim() === "" || !Number.isFinite(n) ? null : n);
      }}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Exercises
// ---------------------------------------------------------------------------

/** Search the library and pick one or more exercises. */
export function ExercisePicker({ exercises, multiple = true, onPick, onClose }: { exercises: Exercise[]; multiple?: boolean; onPick: (ids: string[]) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<Muscle | "">("");
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return exercises.filter((e) => (!muscle || e.muscle === muscle) && words.every((w) => `${e.name} ${e.equipment} ${muscleName(e.muscle)}`.toLowerCase().includes(w)));
  }, [exercises, query, muscle]);

  const toggle = (id: string) => {
    if (!multiple) return onPick([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{multiple ? "Add exercises" : "Choose an exercise"}</DialogTitle>
          <DialogDescription>{exercises.length} in your library. Add your own if one is missing.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} autoFocus onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="pl-9" aria-label="Search exercises" />
            </div>
            <NativeSelect value={muscle} onChange={(e) => setMuscle(e.target.value as Muscle | "")} aria-label="Muscle">
              <option value="">All muscles</option>
              {MUSCLES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <ul className="-mx-2 max-h-[45vh] min-h-32 overflow-y-auto">
            {shown.map((e) => {
              const on = picked.includes(e.id);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => toggle(e.id)} className={cn("flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted", on && "bg-surface-muted")}>
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-[14px] font-medium">{e.name}</span>
                      <span className="truncate text-[12px] capitalize text-muted-foreground">
                        {muscleName(e.muscle)} · {e.equipment}
                      </span>
                    </span>
                    {multiple ? (
                      <span className={cn("grid size-6 place-items-center rounded-full border", on ? "border-transparent bg-accent text-accent-foreground" : "border-border")}>{on ? <Check size={14} weight="bold" /> : null}</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {!shown.length ? <li className="px-2 py-6 text-center text-[14px] text-muted-foreground">No exercise matches.</li> : null}
          </ul>
        </div>
        <DialogFooter>
          <Button variant="ghost" className="mr-auto" onClick={() => setCreating(true)}>
            <Plus />
            New exercise
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {multiple ? (
            <Button disabled={!picked.length} onClick={() => onPick(picked)}>
              Add {picked.length || ""}
            </Button>
          ) : null}
        </DialogFooter>
        {creating ? (
          <ExerciseDialog
            exercise={null}
            initialName={query}
            onClose={() => setCreating(false)}
            onSaved={(id) => {
              setCreating(false);
              if (multiple) setPicked((p) => [...p, id]);
              else onPick([id]);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ExerciseDialog({ exercise, initialName = "", onClose, onSaved }: { exercise: Exercise | null; initialName?: string; onClose: () => void; onSaved?: (id: string) => void }) {
  const save = useSaveExercise();
  const remove = useDeleteExercise();
  const [name, setName] = useState(exercise?.name ?? initialName);
  const [muscle, setMuscle] = useState<Muscle>(exercise?.muscle ?? "chest");
  const [equipment, setEquipment] = useState(exercise?.equipment ?? "barbell");
  const [measure, setMeasure] = useState<Measure>(exercise?.measure ?? "weight");
  const [notes, setNotes] = useState(exercise?.notes ?? "");

  async function submit() {
    if (!name.trim()) return;
    const id = await save.mutateAsync({ id: exercise?.id, name: name.trim(), muscle, equipment, measure, notes: notes.trim() || null });
    if (onSaved) onSaved(id);
    else onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{exercise ? "Edit exercise" : "New exercise"}</DialogTitle>
          <DialogDescription>The muscle it works counts towards weekly volume.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="ex-name">
            <Input id="ex-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Incline Smith Press" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Muscle" htmlFor="ex-muscle">
              <NativeSelect id="ex-muscle" className="w-full" value={muscle} onChange={(e) => setMuscle(e.target.value as Muscle)}>
                {MUSCLES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Equipment" htmlFor="ex-equipment">
              <NativeSelect id="ex-equipment" className="w-full capitalize" value={equipment} onChange={(e) => setEquipment(e.target.value)}>
                {EQUIPMENT.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field label="Each set records" htmlFor="ex-measure">
            <NativeSelect id="ex-measure" className="w-full" value={measure} onChange={(e) => setMeasure(e.target.value as Measure)}>
              {MEASURES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Notes (optional)" htmlFor="ex-notes">
            <Textarea id="ex-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Seat height 4, grip just outside shoulders" />
          </Field>
        </div>
        <DialogFooter>
          {exercise && !exercise.isBuiltin ? (
            <Button
              variant="danger-ghost"
              className="mr-auto"
              onClick={async () => {
                await remove.mutateAsync(exercise.id);
                onClose();
              }}
            >
              <Trash />
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()} loading={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

export function TemplateDialog({ template, exercises, initial, onClose }: { template: WorkoutTemplate | null; exercises: Map<string, Exercise>; initial?: { name: string; exercises: TemplateItem[] }; onClose: () => void }) {
  const save = useSaveTemplate();
  const remove = useDeleteTemplate();
  const [name, setName] = useState(template?.name ?? initial?.name ?? "");
  const [notes, setNotes] = useState(template?.notes ?? "");
  const [items, setItems] = useState<TemplateItem[]>(template?.exercises ?? initial?.exercises ?? []);
  const [picking, setPicking] = useState(false);

  const patch = (i: number, p: Partial<TemplateItem>) => setItems((list) => list.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, by: number) =>
    setItems((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  async function submit() {
    if (!name.trim()) return;
    await save.mutateAsync({ id: template?.id, name: name.trim(), notes: notes.trim() || null, exercises: items });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? "Edit routine" : "New routine"}</DialogTitle>
          <DialogDescription>Starting it fills a workout with these exercises and your last weights.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name" htmlFor="tpl-name">
            <Input id="tpl-name" value={name} autoFocus={!template} onChange={(e) => setName(e.target.value)} placeholder="Upper A" />
          </Field>
          <div className="grid gap-1.5">
            <p className="text-[13px] font-medium">Exercises</p>
            <ul className="grid gap-1.5">
              {items.map((it, i) => {
                const e = exercises.get(it.exerciseId);
                return (
                  <li key={`${it.exerciseId}-${i}`} className="flex items-center gap-2 rounded-xl border border-border px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{e?.name ?? "Removed exercise"}</span>
                    <Input aria-label="Sets" inputMode="numeric" className="h-8 w-12 px-2 text-center" value={it.sets} onChange={(ev) => patch(i, { sets: Math.max(1, Math.min(20, Number(ev.target.value) || 1)) })} />
                    <span className="text-[12px] text-muted-foreground">×</span>
                    <Input
                      aria-label={e?.measure === "time" ? "Seconds" : "Reps"}
                      inputMode="numeric"
                      className="h-8 w-14 px-2 text-center"
                      placeholder={e?.measure === "time" ? "sec" : "reps"}
                      value={it.reps ?? ""}
                      onChange={(ev) => patch(i, { reps: ev.target.value ? Number(ev.target.value) || null : null })}
                    />
                    <span className="flex">
                      <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Remove" onClick={() => setItems((l) => l.filter((_, j) => j !== i))}>
                        <X />
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
            <Button variant="secondary" size="sm" className="justify-self-start" onClick={() => setPicking(true)}>
              <Plus />
              Add exercises
            </Button>
          </div>
          <Field label="Notes (optional)" htmlFor="tpl-notes">
            <Textarea id="tpl-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          {template ? (
            <Button
              variant="danger-ghost"
              className="mr-auto"
              onClick={async () => {
                await remove.mutateAsync(template.id);
                onClose();
              }}
            >
              <Trash />
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()} loading={save.isPending}>
            Save
          </Button>
        </DialogFooter>
        {picking ? (
          <ExercisePicker
            exercises={[...exercises.values()]}
            onClose={() => setPicking(false)}
            onPick={(ids) => {
              setItems((l) => [...l, ...ids.map((exerciseId) => ({ exerciseId, sets: 3, reps: exercises.get(exerciseId)?.measure === "time" ? 60 : 10 }))]);
              setPicking(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Body metrics
// ---------------------------------------------------------------------------

export function MetricDialog({ metric, onClose }: { metric: BodyMetric | null; onClose: () => void }) {
  const save = useSaveMetric();
  const remove = useDeleteMetric();
  const unit = useUnit();
  const [date, setDate] = useState(metric?.date ?? todayKey());
  const [weight, setWeight] = useState<number | null>(metric?.weight != null ? toUnit(metric.weight, unit) : null);
  const [bodyFat, setBodyFat] = useState<number | null>(metric?.bodyFat ?? null);
  const [sizes, setSizes] = useState<Record<string, number | null>>(Object.fromEntries(MEASUREMENTS.map((m) => [m.key, metric?.[m.key] ?? null])));
  const [notes, setNotes] = useState(metric?.notes ?? "");
  const empty = weight === null && bodyFat === null && Object.values(sizes).every((v) => v === null) && !notes.trim();

  async function submit() {
    const input: MetricInput = {
      date,
      weight: weight === null ? null : Math.round(fromUnit(weight, unit) * 100) / 100,
      bodyFat,
      waist: sizes.waist ?? null,
      chest: sizes.chest ?? null,
      arms: sizes.arms ?? null,
      thighs: sizes.thighs ?? null,
      hips: sizes.hips ?? null,
      neck: sizes.neck ?? null,
      notes: notes.trim() || null,
    };
    await save.mutateAsync(input);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{metric ? "Edit entry" : "Log body metrics"}</DialogTitle>
          <DialogDescription>Fill in only what you measured. Measurements are in cm.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date" htmlFor="bm-date">
              <DateTimeInput id="bm-date" type="date" value={date} max={todayKey()} disabled={!!metric} onChange={(e) => setDate(e.target.value || todayKey())} />
            </Field>
            <Field label={`Weight (${unit})`} htmlFor="bm-weight">
              <NumberInput id="bm-weight" value={weight} onChange={setWeight} autoFocus={!metric} />
            </Field>
            <Field label="Body fat %" htmlFor="bm-fat">
              <NumberInput id="bm-fat" value={bodyFat} onChange={setBodyFat} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {MEASUREMENTS.map((m) => (
              <Field key={m.key} label={m.label} htmlFor={`bm-${m.key}`}>
                <NumberInput id={`bm-${m.key}`} value={sizes[m.key] ?? null} onChange={(v) => setSizes((s) => ({ ...s, [m.key]: v }))} />
              </Field>
            ))}
          </div>
          <Field label="Notes (optional)" htmlFor="bm-notes">
            <Textarea id="bm-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          {metric ? (
            <Button
              variant="danger-ghost"
              className="mr-auto"
              onClick={async () => {
                await remove.mutateAsync(metric.date);
                onClose();
              }}
            >
              <Trash />
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={empty} loading={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// A past workout
// ---------------------------------------------------------------------------

export function PastWorkoutDialog({ templates, onClose, onCreated }: { templates: WorkoutTemplate[]; onClose: () => void; onCreated: (id: string) => void }) {
  const log = useLogPastWorkout();
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("Workout");
  const [date, setDate] = useState(addDaysKey(todayKey(), -1));
  const [time, setTime] = useState("18:00");
  const [minutes, setMinutes] = useState("60");
  const mins = Math.round(Number(minutes));
  const template = templates.find((t) => t.id === templateId) ?? null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a past workout</DialogTitle>
          <DialogDescription>
            {template ? "Its sets come in ticked, with your weights from before that day; adjust what differed next." : "It opens next, for its exercises and sets. Sets you add count as done."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {templates.length ? (
            <Field label="From a routine (optional)" htmlFor="past-template">
              <NativeSelect
                id="past-template"
                className="w-full"
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  const t = templates.find((x) => x.id === e.target.value);
                  if (t) setName(t.name);
                }}
              >
                <option value="">None, I'll add exercises</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : null}
          <Field label="Name" htmlFor="past-name">
            <Input id="past-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Date" htmlFor="past-date">
              <DateTimeInput id="past-date" type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} />
            </Field>
            <Field label="Started" htmlFor="past-time">
              <DateTimeInput id="past-time" type="time" value={time} onChange={(e) => setTime(e.target.value || "18:00")} />
            </Field>
            <Field label="Minutes" htmlFor="past-minutes">
              <Input id="past-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || !(mins > 0)}
            loading={log.isPending}
            onClick={async () => {
              onCreated(await log.mutateAsync({ name: name.trim(), date, time, minutes: mins, template }));
            }}
          >
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
