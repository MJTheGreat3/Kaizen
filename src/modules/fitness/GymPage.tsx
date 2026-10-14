import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import { Barbell, CalendarPlus, Fire, Gear, PencilSimple, Play, Plus, Ruler, Trophy } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Segmented, Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import type { WorkoutTemplate } from "@/core/db/schema";
import { useOpenTarget } from "@/core/shell/openRequest";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { addDaysKey, formatLongDate, relativeDay, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { activeDays, streak, weekStart } from "@/modules/activity/logic";
import { modules } from "@/modules/registry";
import { BarChart, MuscleBars } from "./Charts";
import { useAddTemplates, useGym, useStartWorkout, useUnit, type GymData } from "./data";
import { PastWorkoutDialog, TemplateDialog } from "./Dialogs";
import { formatDuration, formatSeconds, formatVolume, isWorking, MUSCLES, setsPerMuscle, STARTER_ROUTINES, toUnit, weeklyTotals, workoutRecords } from "./logic";

const mod = modules.find((m) => m.id === "fitness")!;
const HUE = mod.hue;

function Card({ title, action, className, children }: { title: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <motion.section variants={rise} className={cn("rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5", className)}>
      <SectionTitle action={action}>{title}</SectionTitle>
      {children}
    </motion.section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-1 truncate text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [unit, setUnit] = usePref("gym.unit");
  const [rest, setRest] = usePref("gym.rest");
  const [text, setText] = useState(String(rest));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Gym settings</DialogTitle>
          <DialogDescription>For this device. Weights are stored in kg either way.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <p className="text-[13px] font-medium">Units</p>
            <Segmented
              label="Units"
              value={unit}
              onChange={(v) => void setUnit(v)}
              options={[
                { value: "kg", label: "Kilograms" },
                { value: "lb", label: "Pounds" },
              ]}
            />
          </div>
          <Field label="Rest between sets (seconds)" htmlFor="gym-rest">
            <Input id="gym-rest" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void setRest(Math.max(10, Math.min(600, Number(text) || 90)))} />
          </Field>
        </div>
        <DialogFooter>
          <Button onClick={() => void setRest(Math.max(10, Math.min(600, Number(text) || 90))).then(onClose)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Routines({ data, onStart, onEdit }: { data: GymData; onStart: (t: WorkoutTemplate | null) => void; onEdit: (t: WorkoutTemplate | "new") => void }) {
  const addTemplates = useAddTemplates();
  const lastDone = (id: string) => data.workouts.find((w) => w.templateId === id && w.endedAt);
  if (!data.templates.length) {
    return (
      <div className="grid justify-items-center gap-3 py-6 text-center">
        <p className="max-w-[40ch] text-[14px] text-muted-foreground">Routines start a workout with their exercises and your last weights.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" variant="secondary" loading={addTemplates.isPending} onClick={() => addTemplates.mutate(STARTER_ROUTINES)}>
            Add Push, Pull and Legs
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onEdit("new")}>
            <Plus />
            Your own
          </Button>
        </div>
      </div>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {data.templates.map((t) => {
        const last = lastDone(t.id);
        return (
          <li key={t.id} className="flex items-start gap-2 rounded-xl border border-border p-3">
            <button type="button" onClick={() => onEdit(t)} className="grid min-w-0 flex-1 text-left">
              <span className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
                {t.name}
                <PencilSimple size={12} className="shrink-0 text-muted-foreground" />
              </span>
              <span className="line-clamp-2 text-[12px] text-muted-foreground">{t.exercises.map((x) => data.byId.get(x.exerciseId)?.name ?? "?").join(", ") || "No exercises yet"}</span>
              <span className="mt-1 text-[11px] text-muted-foreground">{last ? `Last done ${/^(Today|Yesterday)$/.test(relativeDay(last.date)) ? relativeDay(last.date).toLowerCase() : `on ${relativeDay(last.date)}`}` : "Not done yet"}</span>
            </button>
            <Button size="icon-sm" aria-label={`Start ${t.name}`} onClick={() => onStart(t)} disabled={!!data.active}>
              <Play weight="fill" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function GymPage() {
  const { data, isLoading } = useGym();
  const navigate = useNavigate();
  const start = useStartWorkout();
  const unit = useUnit();
  const now = useNow(1000).getTime();
  const [editing, setEditing] = useState<WorkoutTemplate | "new" | null>(null);
  const [past, setPast] = useState(false);
  const [settings, setSettings] = useState(false);
  const [range, setRange] = useState<"volume" | "sessions">("volume");
  const [allHistory, setAllHistory] = useState(false);
  const today = todayKey();

  const open = (id: string) => void navigate({ to: "/fitness/workout", search: { w: id } });
  async function begin(t: WorkoutTemplate | null) {
    open(await start.mutateAsync(t));
  }

  useOpenTarget(["fitness"], !!data, (target) => {
    if (!data) return;
    if (target.id === "start") return void begin(null);
    if (data.workouts.some((w) => w.id === target.id)) return open(target.id);
    if (data.byId.has(target.id)) return void navigate({ to: "/fitness/exercises", search: { e: target.id } });
    const t = data.templates.find((x) => x.id === target.id);
    if (t) setEditing(t);
  });

  const view = useMemo(() => {
    if (!data) return null;
    const finished = data.workouts.filter((w) => w.endedAt);
    const days = new Map<string, number>();
    for (const w of finished) days.set(w.date, (days.get(w.date) ?? 0) + 1);
    const thisWeek = finished.filter((w) => w.date >= weekStart(today));
    const weeks = weeklyTotals(finished, today, 12);
    const muscles = setsPerMuscle(data.sets, finished, data.byId, weekStart(today), today);
    const before = setsPerMuscle(data.sets, finished, data.byId, addDaysKey(weekStart(today), -28), addDaysKey(weekStart(today), -1));
    const muscleRows = MUSCLES.filter((m) => muscles.get(m.id) || before.get(m.id)).map((m) => ({ name: m.name, value: muscles.get(m.id) ?? 0, average: (before.get(m.id) ?? 0) / 4 }));
    const lastWeight = [...data.metrics].reverse().find((m) => m.weight != null);
    return {
      finished,
      thisWeek,
      weeks,
      muscleRows,
      lastWeight,
      streak: streak(activeDays(days, data.rule), data.rule, today),
      records: new Map(finished.slice(0, 30).map((w) => [w.id, workoutRecords(w, data.sets, data.workouts, data.byId).length])),
    };
  }, [data, today]);

  return (
    <Page hue={HUE} className="max-w-[1100px]">
      <PageHeader
        title="Gym"
        description="Workouts, routines, records and your body."
        icon={mod.icon}
        hue={HUE}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" aria-label="Gym settings" onClick={() => setSettings(true)}>
              <Gear />
            </Button>
            {data?.active ? (
              <Button size="sm" onClick={() => open(data.active!.id)}>
                <Play weight="fill" />
                Resume
              </Button>
            ) : (
              <Button size="sm" loading={start.isPending} onClick={() => void begin(null)}>
                <Plus />
                <span className="hidden sm:inline">Start workout</span>
                <span className="sm:hidden">Start</span>
              </Button>
            )}
          </div>
        }
      />

      {isLoading || !data || !view ? (
        <div className="mt-8 grid gap-4">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="mt-8 grid gap-4">
          {data.active ? (
            <motion.button
              variants={rise}
              type="button"
              onClick={() => open(data.active!.id)}
              className="relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-surface p-4 text-left shadow-soft"
            >
              <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${HUE} 18%, transparent), transparent)` }} />
              <span className="relative grid size-11 place-items-center rounded-xl text-white" style={{ background: HUE }}>
                <Barbell size={22} weight="fill" />
              </span>
              <span className="relative grid min-w-0 flex-1">
                <span className="truncate text-[15px] font-semibold">{data.active.name} in progress</span>
                <span className="text-[13px] text-muted-foreground">
                  {data.sets.filter((s) => s.workoutId === data.active!.id && s.done).length} sets done · tap to continue
                </span>
              </span>
              <span className="relative text-[20px] font-semibold tabular-nums">{formatSeconds(Math.floor((now - data.active.startedAt) / 1000))}</span>
            </motion.button>
          ) : null}

          <motion.div variants={rise} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="This week" value={`${view.thisWeek.length} / ${data.rule.perWeek}`} sub={view.thisWeek.length >= data.rule.perWeek ? "Week done" : `${data.rule.perWeek - view.thisWeek.length} to go`} />
            <Stat label="Volume this week" value={formatVolume(view.weeks.at(-1)!.volume, unit)} sub={`${formatVolume(view.weeks.at(-2)!.volume, unit)} last week`} />
            <Stat
              label="Gym streak"
              value={
                <span className="flex items-center gap-1.5">
                  <Fire size={20} weight={view.streak.current ? "fill" : "regular"} style={{ color: view.streak.current ? HUE : undefined }} />
                  {view.streak.current}
                </span>
              }
              sub={`${view.streak.unit} · best ${view.streak.longest}`}
            />
            <Stat label="Bodyweight" value={view.lastWeight ? `${toUnit(view.lastWeight.weight!, unit)} ${unit}` : "–"} sub={view.lastWeight ? formatLongDate(view.lastWeight.date) : "Log it under Body"} />
          </motion.div>

          <Card
            title="Routines"
            action={
              data.templates.length ? (
                <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
                  <Plus />
                  Routine
                </Button>
              ) : null
            }
          >
            <Routines data={data} onStart={(t) => void begin(t)} onEdit={setEditing} />
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card
              title="Last 12 weeks"
              action={
                <Segmented
                  label="Show"
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: "volume", label: "Volume" },
                    { value: "sessions", label: "Workouts" },
                  ]}
                />
              }
            >
              <BarChart
                label={range === "volume" ? "Weekly volume" : "Workouts per week"}
                color={HUE}
                format={(v) => (range === "volume" ? formatVolume(v, unit) : String(Math.round(v)))}
                bars={view.weeks.map((w) => ({
                  key: w.from,
                  label: new Date(`${w.from}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" }),
                  value: range === "volume" ? w.volume : w.sessions,
                  detail: `Week of ${new Date(`${w.from}T12:00:00`).toLocaleDateString([], { day: "numeric", month: "short" })} · ${w.sessions} ${w.sessions === 1 ? "workout" : "workouts"}`,
                }))}
              />
            </Card>
            <Card title="Sets per muscle this week">
              <MuscleBars rows={view.muscleRows} color={HUE} />
              {view.muscleRows.length ? <p className="mt-3 text-[12px] text-muted-foreground">The tick marks your weekly average over the four weeks before.</p> : null}
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-[1.4fr_1fr]">
            <Card
              title="History"
              action={
                <Button size="sm" variant="ghost" onClick={() => setPast(true)}>
                  <CalendarPlus />
                  Past workout
                </Button>
              }
            >
              {view.finished.length ? (
                <ul className="-mx-1 grid gap-0.5">
                  {view.finished.slice(0, allHistory ? undefined : 6).map((w) => {
                    const sets = data.sets.filter((s) => s.workoutId === w.id);
                    const names = [...new Set(sets.map((s) => data.byId.get(s.exerciseId)?.name).filter(Boolean))];
                    const records = view.records.get(w.id) ?? 0;
                    return (
                      <li key={w.id}>
                        <button type="button" onClick={() => open(w.id)} className="grid w-full gap-0.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 truncate text-[14px] font-medium">
                              {w.name}
                              {records ? (
                                <span className="flex shrink-0 items-center gap-0.5 text-[12px] text-amber-500">
                                  <Trophy size={12} weight="fill" />
                                  {records}
                                </span>
                              ) : null}
                            </span>
                            <span className="shrink-0 text-[12px] text-muted-foreground">{relativeDay(w.date)}</span>
                          </span>
                          <span className="truncate text-[12px] text-muted-foreground">
                            {formatDuration(w.endedAt! - w.startedAt)} · {formatVolume(w.volume, unit)} · {sets.filter(isWorking).length} sets
                            {names.length ? ` · ${names.join(", ")}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                  {!allHistory && view.finished.length > 6 ? (
                    <button type="button" onClick={() => setAllHistory(true)} className="mt-2 justify-self-center text-[13px] font-medium text-muted-foreground hover:text-foreground">
                      Show all {view.finished.length}
                    </button>
                  ) : null}
                </ul>
              ) : (
                <p className="py-6 text-center text-[14px] text-muted-foreground">Finished workouts show here and on the heatmap.</p>
              )}
            </Card>

            <div className="grid content-start gap-4">
              <motion.div variants={rise}>
                <Link to="/fitness/exercises" search={{}} className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-soft transition-colors hover:bg-surface-muted">
                  <span className="grid size-10 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${HUE} 14%, transparent)`, color: HUE }}>
                    <Trophy size={20} weight="duotone" />
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="text-[14px] font-semibold">Exercises and records</span>
                    <span className="truncate text-[12px] text-muted-foreground">{data.exercises.length} exercises, progress charts</span>
                  </span>
                </Link>
              </motion.div>
              <motion.div variants={rise}>
                <Link to="/fitness/body" className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-soft transition-colors hover:bg-surface-muted">
                  <span className="grid size-10 place-items-center rounded-xl" style={{ background: `color-mix(in srgb, ${HUE} 14%, transparent)`, color: HUE }}>
                    <Ruler size={20} weight="duotone" />
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="text-[14px] font-semibold">Body</span>
                    <span className="truncate text-[12px] text-muted-foreground">
                      {data.metrics.length ? `${data.metrics.length} entries, ${data.photos.length} photos` : "Weight, measurements and photos"}
                    </span>
                  </span>
                </Link>
              </motion.div>
            </div>
          </div>
        </div>
      )}

      {editing ? <TemplateDialog template={editing === "new" ? null : editing} exercises={data?.byId ?? new Map()} onClose={() => setEditing(null)} /> : null}
      {past ? (
        <PastWorkoutDialog
          onClose={() => setPast(false)}
          onCreated={(id) => {
            setPast(false);
            open(id);
          }}
        />
      ) : null}
      {settings ? <SettingsDialog onClose={() => setSettings(false)} /> : null}
    </Page>
  );
}
