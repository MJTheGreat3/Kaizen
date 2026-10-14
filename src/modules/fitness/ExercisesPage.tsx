import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowLeft, MagnifyingGlass, PencilSimple, Plus, Trophy } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Skeleton } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/kit";
import type { Exercise, Muscle } from "@/core/db/schema";
import { Page } from "@/core/shell/PageHeader";
import { formatLongDate } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { modules, pathOf } from "@/modules/registry";
import { LineChart } from "./Charts";
import { useGym, useUnit, type GymData } from "./data";
import { ExerciseDialog } from "./Dialogs";
import { bests, describeSet, formatRecord, isWorking, MUSCLES, muscleName, progress, RECORD_LABELS, recordKinds, toUnit } from "./logic";

const HUE = modules.find((m) => m.id === "fitness")!.hue;

function Library({ data }: { data: GymData }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [muscle, setMuscle] = useState<Muscle | "">("");
  const [mine, setMine] = useState<"all" | "used" | "custom">("all");
  const [creating, setCreating] = useState(false);
  const counts = useMemo(() => {
    const done = new Set(data.workouts.filter((w) => w.endedAt).map((w) => w.id));
    const out = new Map<string, number>();
    for (const s of data.sets) if (done.has(s.workoutId) && isWorking(s)) out.set(s.exerciseId, (out.get(s.exerciseId) ?? 0) + 1);
    return out;
  }, [data]);
  const shown = data.exercises.filter((e) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (muscle && e.muscle !== muscle) return false;
    if (mine === "used" && !counts.get(e.id)) return false;
    if (mine === "custom" && e.isBuiltin) return false;
    return words.every((w) => `${e.name} ${e.equipment}`.toLowerCase().includes(w));
  });
  const groups = MUSCLES.map((m) => ({ m, list: shown.filter((e) => e.muscle === m.id) })).filter((g) => g.list.length);

  return (
    <>
      <motion.div variants={rise} className="mt-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold tracking-tight">Exercises</h1>
          <p className="text-[14px] text-muted-foreground">{data.exercises.length} in your library. Open one for its records and progress.</p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus />
          New
        </Button>
      </motion.div>
      <motion.div variants={rise} className="mt-5 flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="pl-9" aria-label="Search exercises" />
        </div>
        <NativeSelect value={muscle} onChange={(e) => setMuscle(e.target.value as Muscle | "")} aria-label="Muscle">
          <option value="">All muscles</option>
          {MUSCLES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </NativeSelect>
        <Segmented
          label="Show"
          value={mine}
          onChange={setMine}
          options={[
            { value: "all", label: "All" },
            { value: "used", label: "Done" },
            { value: "custom", label: "Mine" },
          ]}
        />
      </motion.div>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {groups.map(({ m, list }) => (
          <motion.section key={m.id} variants={rise} className="rounded-2xl border border-border bg-surface p-3 shadow-soft">
            <h2 className="px-2 pb-1 pt-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">{m.name}</h2>
            <ul className="grid">
              {list.map((e) => (
                <li key={e.id}>
                  <button type="button" onClick={() => void navigate({ to: "/fitness/exercises", search: { e: e.id } })} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted">
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate text-[14px] font-medium">{e.name}</span>
                      <span className="truncate text-[12px] capitalize text-muted-foreground">
                        {e.equipment}
                        {e.isBuiltin ? "" : " · yours"}
                      </span>
                    </span>
                    {counts.get(e.id) ? <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{counts.get(e.id)} sets</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </motion.section>
        ))}
        {!groups.length ? <p className="py-10 text-center text-[14px] text-muted-foreground md:col-span-2">No exercise matches.</p> : null}
      </div>
      {creating ? <ExerciseDialog exercise={null} initialName={query} onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function Detail({ data, exercise }: { data: GymData; exercise: Exercise }) {
  const unit = useUnit();
  const [editing, setEditing] = useState(false);
  const finished = useMemo(() => new Map(data.workouts.filter((w) => w.endedAt).map((w) => [w.id, w])), [data]);
  const sets = useMemo(() => data.sets.filter((s) => s.exerciseId === exercise.id && finished.has(s.workoutId)), [data, exercise, finished]);
  const records = bests(sets, exercise.measure);
  const points = progress(exercise, data.sets, data.workouts).map((p) => ({ at: p.at, value: p.value }));
  const kind = recordKinds(exercise.measure)[exercise.measure === "weight" ? 1 : 0]!;
  const sessions = [...new Set(sets.map((s) => s.workoutId))].map((id) => finished.get(id)!).sort((a, b) => b.startedAt - a.startedAt);
  const [showAll, setShowAll] = useState(false);

  return (
    <>
      <motion.section variants={rise} className="relative mt-4 overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${HUE} 14%, transparent), transparent 60%)` }} />
        <div className="relative flex items-start gap-3">
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              {muscleName(exercise.muscle)} · {exercise.equipment}
            </span>
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{exercise.name}</h1>
            {exercise.notes ? <p className="text-[14px] text-muted-foreground">{exercise.notes}</p> : null}
            <p className="text-[13px] text-muted-foreground">
              {sessions.length ? `${sessions.length} ${sessions.length === 1 ? "workout" : "workouts"}, ${sets.filter(isWorking).length} working sets` : "Not done yet"}
            </p>
          </div>
          <Button size="sm" variant="ghost" aria-label="Edit exercise" onClick={() => setEditing(true)}>
            <PencilSimple />
          </Button>
        </div>
        {records.length ? (
          <div className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {records.map((r) => {
              const w = finished.get(r.set.workoutId);
              return (
                <div key={r.kind} className="rounded-xl bg-surface-muted/70 px-3 py-2.5">
                  <p className="flex items-center gap-1 text-[12px] text-muted-foreground">
                    <Trophy size={12} weight="fill" className="text-amber-500" />
                    {RECORD_LABELS[r.kind]}
                  </p>
                  <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{formatRecord(r.kind, r.value, unit)}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {describeSet(r.set, exercise.measure, unit)}
                    {w ? ` · ${new Date(w.startedAt).toLocaleDateString([], { day: "numeric", month: "short" })}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}
      </motion.section>

      <motion.section variants={rise} className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
        <SectionTitle>{RECORD_LABELS[kind]}, per workout</SectionTitle>
        <LineChart points={points} color={HUE} label={`${exercise.name} progress`} format={(v) => (kind === "weight" || kind === "e1rm" ? `${toUnit(v, unit)}` : formatRecord(kind, v, unit))} />
      </motion.section>

      <motion.section variants={rise} className="mt-4 rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
        <SectionTitle>History</SectionTitle>
        {sessions.length ? (
          <ul className="-mx-1 grid gap-0.5">
            {sessions.slice(0, showAll ? undefined : 8).map((w) => (
              <li key={w.id}>
                <Link to="/fitness/workout" search={{ w: w.id }} className="grid gap-1 rounded-xl px-2 py-2 transition-colors hover:bg-surface-muted">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[14px] font-medium">{w.name}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">{formatLongDate(w.date)}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {sets
                      .filter((s) => s.workoutId === w.id)
                      .sort((a, b) => a.setIndex - b.setIndex)
                      .map((s) => (
                        <span key={s.id} className={`rounded-md px-1.5 py-0.5 text-[12px] tabular-nums ${s.warmup ? "text-muted-foreground" : "bg-surface-muted"}`}>
                          {describeSet(s, exercise.measure, unit)}
                        </span>
                      ))}
                  </span>
                </Link>
              </li>
            ))}
            {!showAll && sessions.length > 8 ? (
              <button type="button" onClick={() => setShowAll(true)} className="mt-2 justify-self-center text-[13px] font-medium text-muted-foreground hover:text-foreground">
                Show all {sessions.length}
              </button>
            ) : null}
          </ul>
        ) : (
          <p className="py-6 text-center text-[14px] text-muted-foreground">Add it to a workout to start its history.</p>
        )}
      </motion.section>
      {editing ? <ExerciseDialog exercise={exercise} onClose={() => setEditing(false)} /> : null}
    </>
  );
}

/** The exercise library, or one exercise's records, progress and history. */
export function ExercisesPage() {
  const { e } = useSearch({ from: "/fitness/exercises" });
  const { data, isLoading } = useGym();
  const exercise = e ? data?.byId.get(e) : undefined;
  return (
    <Page hue={HUE} className="max-w-[960px]">
      <motion.div variants={rise} className="flex items-center gap-2">
        {exercise ? (
          <Link to="/fitness/exercises" search={{}} className="flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
            Exercises
          </Link>
        ) : (
          <Link to={pathOf("fitness")} className="flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
            Gym
          </Link>
        )}
      </motion.div>
      {isLoading || !data ? <Skeleton className="mt-6 h-64 rounded-2xl" /> : exercise ? <Detail data={data} exercise={exercise} /> : <Library data={data} />}
    </Page>
  );
}
