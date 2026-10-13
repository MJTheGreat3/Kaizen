import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  Coins,
  Flag,
  Lightning,
  Lock,
  Minus,
  MoonStars,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Tag,
  Timer,
  Tree as TreeIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Skeleton, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Chip, ConfirmDialog, EmptyState, SectionTitle } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import type { FocusSession } from "@/core/db/schema";
import { isMobile, useSession } from "@/core/security/session";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { addDaysKey, fromKey, todayKey } from "@/lib/dates";
import { ease, rise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useTasks } from "@/modules/lists/data";
import { modules } from "@/modules/registry";
import { finishSession, pauseSession, resumeSession, startSession, unlockSpecies, useFocus, useFocusMutation } from "./data";
import { useFocusAway, useNow } from "./engine";
import {
  coins,
  endsAt,
  formatClock,
  formatMinutes,
  isUnlocked,
  PRESETS,
  progress,
  remainingMs,
  SPECIES,
  speciesFor,
  stats,
  type Species,
} from "./logic";
import { focusNative } from "./native";
import { Tree } from "./Tree";

const mod = modules.find((m) => m.id === "focus")!;
const HUE = mod.hue;

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** Circular progress drawn around the tree. */
function GrowthRing({ value }: { value: number }) {
  const size = 300;
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 size-full -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="color-mix(in srgb, var(--foreground) 8%, transparent)" strokeWidth="5" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={HUE}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        initial={false}
        animate={{ strokeDashoffset: c * (1 - value) }}
        transition={{ duration: 0.9, ease }}
      />
    </svg>
  );
}

function SpeciesPicker({
  value,
  onChange,
  unlocked,
  onLocked,
}: {
  value: string;
  onChange: (key: string) => void;
  unlocked: (s: Species) => boolean;
  onLocked: (s: Species) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Tree" className="grid grid-cols-3 gap-2">
      {SPECIES.map((s) => {
        const open = unlocked(s);
        const selected = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={open ? s.name : `${s.name}, locked: ${s.cost} coins`}
            onClick={() => (open ? onChange(s.key) : onLocked(s))}
            className={cn(
              "relative grid justify-items-center gap-1 rounded-xl border px-2 pb-2 pt-1 transition-colors",
              selected ? "border-transparent" : "border-border bg-surface hover:bg-surface-muted",
            )}
            style={selected ? { background: `color-mix(in srgb, ${HUE} 14%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${HUE}` } : undefined}
          >
            <Tree species={s.key} className={cn("h-14 w-14", !open && "opacity-35 grayscale")} ground={false} />
            <span className="max-w-full truncate text-[11px] font-medium text-muted-foreground">{s.name}</span>
            {!open ? (
              <span className="absolute right-1.5 top-1.5 flex items-center gap-0.5 rounded-full bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-soft">
                <Lock size={10} weight="bold" />
                {s.cost}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const step = (d: number) => onChange(Math.min(180, Math.max(5, value + d)));
  return (
    <div className="flex items-center gap-1 rounded-full border border-border bg-surface p-1 shadow-soft">
      <Button variant="ghost" size="icon-sm" aria-label="Five minutes less" onClick={() => step(-5)}>
        <Minus />
      </Button>
      <span className="w-16 text-center text-[15px] font-semibold tabular-nums">{value} min</span>
      <Button variant="ghost" size="icon-sm" aria-label="Five minutes more" onClick={() => step(5)}>
        <Plus />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function SetupCard({ tags, unlocked, onLocked }: { tags: string[]; unlocked: (s: Species) => boolean; onLocked: (s: Species) => void }) {
  const info = useSession((s) => s.info);
  const mobile = isMobile(info);
  const [minutes, setMinutes] = usePref("focus.minutes");
  const [rest, setRest] = usePref("focus.rest");
  const [speciesKey, setSpecies] = usePref("focus.species");
  const [strict, setStrict] = usePref("focus.strict");
  const [dnd, setDnd] = usePref("focus.dnd");
  const [grace] = usePref("focus.grace");
  const [tag, setTag] = useState("");
  const [taskId, setTaskId] = useState("");
  const tasks = useTasks("todo");
  const openTasks = (tasks.data ?? []).filter((t) => t.status !== "done");
  const species = unlocked(speciesFor(speciesKey)) ? speciesKey : "oak";

  const start = useFocusMutation(async () => {
    const perms = mobile ? await focusNative.permissions() : null;
    if (perms && dnd && !perms.dnd) {
      toast("Allow Do Not Disturb access", {
        description: "This session runs without it. Turn on Kaizen in the list so the next one can silence notifications.",
        action: { label: "Open settings", onClick: () => void focusNative.openDndSettings() },
      });
    }
    if (strict) {
      if (perms && !perms.usage) {
        toast("Allow usage access for strict mode", {
          description: "Kaizen needs it to notice when you open another app. Turn on Kaizen in the list, then come back.",
          action: { label: "Open settings", onClick: () => void focusNative.openUsageSettings() },
        });
        throw new Error("Usage access is needed for strict mode");
      }
    }
    const session = await startSession({ minutes, tag: tag.trim() || null, taskId: taskId || null, species, strict });
    await focusNative.start({
      sessionId: session.id,
      title: tag.trim() ? `Focus: ${tag.trim()}` : "Focus session",
      endsAt: endsAt(session, Date.now()),
      strict,
      dnd: mobile && dnd,
      graceSeconds: grace,
    });
    return session;
  });

  return (
    <motion.section variants={rise} className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-soft">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-56"
        style={{ background: `radial-gradient(70% 90% at 50% 0%, color-mix(in srgb, ${HUE} 18%, transparent), transparent 75%)` }}
      />
      <div className="relative grid gap-6 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:gap-8 md:p-8">
        <div className="grid place-items-center">
          <motion.div key={species} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
            <Tree species={species} growth={1} sway className="h-52 w-52 md:h-72 md:w-72" />
          </motion.div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {formatMinutes(minutes)} grows {/^[aeiou]/i.test(speciesFor(species).name) ? "an" : "a"} {speciesFor(species).name.toLowerCase()}
          </p>
        </div>

        <div className="grid content-start gap-5">
          <div className="grid gap-2.5">
            <span className="text-[13px] font-medium text-muted-foreground">Length</span>
            <div className="flex flex-wrap items-center gap-2">
              {PRESETS.map((p) => {
                const on = p.focus === minutes;
                return (
                  <button
                    key={p.focus}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setMinutes(p.focus);
                      setRest(p.rest);
                    }}
                    className={cn(
                      "grid h-14 min-w-[84px] content-center rounded-xl border px-3 text-left transition-colors active:scale-[0.98]",
                      on ? "border-transparent text-white" : "border-border bg-surface hover:bg-surface-muted",
                    )}
                    style={on ? { background: HUE } : undefined}
                  >
                    <span className="text-[15px] font-semibold tabular-nums">
                      {p.focus}/{p.rest}
                    </span>
                    <span className={cn("text-[11px]", on ? "text-white/80" : "text-muted-foreground")}>{p.label}</span>
                  </button>
                );
              })}
              <Stepper
                value={minutes}
                onChange={(v) => {
                  setMinutes(v);
                  setRest(Math.max(5, Math.round(v / 5)));
                }}
              />
            </div>
            <span className="text-[12px] text-muted-foreground">Then a {rest}-minute break.</span>
          </div>

          <div className="grid gap-2">
            <span className="text-[13px] font-medium text-muted-foreground">Tree</span>
            <SpeciesPicker value={species} onChange={setSpecies} unlocked={unlocked} onLocked={onLocked} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="focus-tag" className="text-[13px] font-medium text-muted-foreground">
                Tag
              </label>
              <Input id="focus-tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="dsa, study, project…" list="focus-tags" />
              <datalist id="focus-tags">
                {tags.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="focus-task" className="text-[13px] font-medium text-muted-foreground">
                Task
              </label>
              <NativeSelect id="focus-task" value={taskId} onChange={(e) => setTaskId(e.target.value)} className="h-11 w-full text-[15px] font-normal">
                <option value="">None</option>
                {openTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {tags.length ? (
            <div className="-mt-2 flex flex-wrap gap-1.5">
              {tags.slice(0, 6).map((t) => (
                <button key={t} type="button" onClick={() => setTag(t)} className="rounded-full">
                  <Chip icon={Tag} tone={t === tag ? "hue" : "muted"} hue={HUE}>
                    {t}
                  </Chip>
                </button>
              ))}
            </div>
          ) : null}

          <div className="grid gap-1 rounded-xl bg-surface-muted/60 p-1">
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-2.5">
              <span className="flex items-center gap-3">
                <ShieldCheck size={20} style={{ color: HUE }} weight="duotone" />
                <span className="grid">
                  <span className="text-[14px] font-medium">Strict mode</span>
                  <span className="text-[12px] text-muted-foreground">
                    {mobile ? `Opening another app withers the tree after ${grace} s.` : `Leaving this window withers the tree after ${grace} s.`}
                  </span>
                </span>
              </span>
              <Switch checked={strict} onCheckedChange={setStrict} aria-label="Strict mode" />
            </label>
            {mobile ? (
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-2.5">
                <span className="flex items-center gap-3">
                  <MoonStars size={20} style={{ color: HUE }} weight="duotone" />
                  <span className="grid">
                    <span className="text-[14px] font-medium">Do Not Disturb</span>
                    <span className="text-[12px] text-muted-foreground">Silences notifications until the session ends.</span>
                  </span>
                </span>
                <Switch checked={dnd} onCheckedChange={setDnd} aria-label="Do Not Disturb" />
              </label>
            ) : null}
          </div>

          <Button
            size="lg"
            className="h-13 text-[16px]"
            style={{ background: HUE }}
            loading={start.isPending}
            onClick={() =>
              start.mutate(undefined, {
                onError: (e) => {
                  if (!errorText(e).includes("Usage access")) toast.error(errorText(e));
                },
              })
            }
          >
            <Play weight="fill" />
            Plant and focus
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

function RunningCard({ session }: { session: FocusSession }) {
  const info = useSession((s) => s.info);
  const mobile = isMobile(info);
  const now = useNow(true, 1000);
  const away = useFocusAway((s) => s.away);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [dnd] = usePref("focus.dnd");
  const [grace] = usePref("focus.grace");
  const paused = session.status === "paused";
  const left = remainingMs(session, now);
  const grown = progress(session, now);
  const species = speciesFor(session.species);

  const toggle = useFocusMutation(async () => {
    if (paused) {
      await resumeSession(session);
      await focusNative.resume(Date.now() + remainingMs(session, session.pausedAt ?? Date.now()));
    } else {
      await pauseSession(session);
      await focusNative.pause(remainingMs(session, Date.now()));
    }
  });
  const giveUp = useFocusMutation(async () => {
    await finishSession(session, "given_up");
    await focusNative.stop();
  });

  return (
    <motion.section
      variants={rise}
      className="relative overflow-hidden rounded-3xl border border-border shadow-soft"
      style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${HUE} 16%, var(--surface)), var(--surface) 70%)` }}
    >
      <div className="grid justify-items-center gap-5 px-5 pb-6 pt-8 md:pb-8 md:pt-10">
        <div className="flex flex-wrap justify-center gap-1.5">
          <Chip icon={TreeIcon} tone="hue" hue={HUE}>
            {species.name}
          </Chip>
          {session.tag ? (
            <Chip icon={Tag} tone="hue" hue={HUE}>
              {session.tag}
            </Chip>
          ) : null}
          {session.strict ? <Chip icon={ShieldCheck}>Strict</Chip> : null}
          {mobile && dnd ? <Chip icon={MoonStars}>Do Not Disturb</Chip> : null}
        </div>

        <div className="relative grid size-[260px] place-items-center md:size-[300px]">
          <GrowthRing value={grown} />
          <Tree species={session.species} growth={grown} sway={!paused} className="relative h-[190px] w-[190px] md:h-[220px] md:w-[220px]" />
        </div>

        <div className="grid justify-items-center gap-1">
          <span className="text-[56px] font-semibold leading-none tracking-[-0.04em] tabular-nums md:text-[64px]">
            {formatClock(left)}
          </span>
          <span className="text-[14px] text-muted-foreground">
            {paused ? "Paused" : `Ends at ${new Date(endsAt(session, now)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
          </span>
        </div>

        <div className="flex gap-2">
          <Button size="lg" variant="secondary" loading={toggle.isPending} onClick={() => toggle.mutate(undefined)}>
            {paused ? <Play weight="fill" /> : <Pause weight="fill" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          <Button size="lg" variant="danger-ghost" onClick={() => setConfirmGiveUp(true)}>
            <Flag />
            Give up
          </Button>
        </div>
      </div>

      <AnimatePresence>
        {away ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 grid place-items-center bg-background/85 backdrop-blur-sm"
          >
            <div className="grid justify-items-center gap-2 px-6 text-center">
              <Lightning size={32} className="text-danger" weight="fill" />
              <p className="text-[18px] font-semibold">Stay with your tree</p>
              <p className="max-w-[34ch] text-[14px] text-muted-foreground">
                Strict mode is on. Come back within {grace} seconds or it withers.
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmGiveUp}
        onOpenChange={setConfirmGiveUp}
        title="Give up this session?"
        description={`Your ${species.name.toLowerCase()} withers and no coins are earned. The time so far is still recorded.`}
        confirmLabel="Give up"
        onConfirm={() => giveUp.mutate(undefined)}
      />
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// After a session: result and break
// ---------------------------------------------------------------------------

function ResultCard({ session, onDone }: { session: FocusSession; onDone: () => void }) {
  const [rest] = usePref("focus.rest");
  const [breakEnds, setBreakEnds] = useState<number | null>(null);
  const now = useNow(breakEnds !== null, 1000);
  const grown = session.status === "completed";
  const species = speciesFor(session.species);
  const breakLeft = breakEnds ? Math.max(0, breakEnds - now) : 0;

  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease }}
      className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-soft"
    >
      <div className="grid justify-items-center gap-4 px-5 py-8 text-center">
        <motion.div initial={{ scale: 0.6, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 180, damping: 14 }}>
          <Tree species={session.species} growth={grown ? 1 : Math.max(0.3, session.focusedMinutes / session.plannedMinutes)} withered={!grown} className="h-44 w-44" />
        </motion.div>
        {grown ? (
          <>
            <p className="text-[22px] font-semibold tracking-tight">Your {species.name.toLowerCase()} has grown</p>
            <p className="text-[14px] text-muted-foreground">
              {formatMinutes(session.focusedMinutes)} of focus
              {session.tag ? ` on ${session.tag}` : ""}. +{Math.floor(session.focusedMinutes)} coins.
            </p>
          </>
        ) : (
          <>
            <p className="text-[22px] font-semibold tracking-tight">This one withered</p>
            <p className="text-[14px] text-muted-foreground">
              {session.status === "withered" ? "You left during strict mode." : "You gave up."} {formatMinutes(session.focusedMinutes)} were still
              focused. Plant another when you are ready.
            </p>
          </>
        )}
        {breakEnds ? (
          <div className="grid justify-items-center gap-2">
            <span className="text-[40px] font-semibold tabular-nums tracking-[-0.03em]">{formatClock(breakLeft)}</span>
            <span className="text-[13px] text-muted-foreground">{breakLeft ? "Break: stretch, water, look away" : "Break's over"}</span>
            <Button onClick={onDone}>{breakLeft ? "End break" : "Plant the next one"}</Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            {grown ? (
              <Button variant="secondary" onClick={() => setBreakEnds(Date.now() + rest * 60_000)}>
                <Timer />
                {rest}-minute break
              </Button>
            ) : null}
            <Button onClick={onDone} style={{ background: HUE }}>
              <Plus />
              Plant another
            </Button>
          </div>
        )}
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Forest and stats
// ---------------------------------------------------------------------------

type Range = "today" | "week" | "month";

function Forest({ sessions }: { sessions: FocusSession[] }) {
  const [range, setRange] = useState<Range>("today");
  const today = todayKey();
  const from = range === "today" ? today : addDaysKey(today, range === "week" ? -6 : -29);
  const trees = sessions
    .filter((s) => s.date >= from && s.date <= today && (s.status === "completed" || s.status === "withered" || s.status === "given_up"))
    .sort((a, b) => a.startedAt - b.startedAt);
  const grown = trees.filter((s) => s.status === "completed");

  return (
    <motion.section variants={rise}>
      <SectionTitle
        action={
          <Segmented
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { value: "today", label: "Today" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
            ]}
          />
        }
      >
        Your forest
      </SectionTitle>
      <div
        className="relative overflow-hidden rounded-3xl border border-border p-4 md:p-6"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, #7fc8a9 16%, var(--surface)) 0%, color-mix(in srgb, #8bbf6a 22%, var(--surface)) 100%)",
        }}
      >
        {trees.length ? (
          <>
            <p className="mb-2 text-[13px] text-muted-foreground">
              {grown.length} {grown.length === 1 ? "tree" : "trees"} · {formatMinutes(grown.reduce((a, s) => a + s.focusedMinutes, 0))}
              {trees.length > grown.length ? ` · ${trees.length - grown.length} withered` : ""}
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-1 gap-y-0">
              {trees.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 10, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.45, ease, delay: Math.min(i, 24) * 0.03 }}
                  title={`${new Date(s.startedAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })} · ${formatMinutes(s.focusedMinutes)}${s.tag ? ` · ${s.tag}` : ""}`}
                  className={cn("grid place-items-center", i % 2 && "translate-y-2")}
                >
                  <Tree species={s.species} withered={s.status !== "completed"} ground={false} className="h-16 w-16" />
                </motion.div>
              ))}
            </div>
          </>
        ) : (
          <EmptyState icon={TreeIcon} hue={HUE} title={range === "today" ? "Nothing planted today" : "No trees here yet"}>
            Every finished session plants a tree here. Leave during strict mode and it withers.
          </EmptyState>
        )}
      </div>
    </motion.section>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function hourLabel(h: number) {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Stats({ sessions }: { sessions: FocusSession[] }) {
  const s = useMemo(() => stats(sessions), [sessions]);
  const max = Math.max(30, ...s.days.map((d) => d.minutes));
  const maxTag = Math.max(1, ...s.tags.map((t) => t.minutes));
  return (
    <motion.section variants={rise} className="grid gap-4">
      <SectionTitle>Stats</SectionTitle>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Today" value={formatMinutes(s.todayMinutes)} />
        <StatTile label="Last 7 days" value={formatMinutes(s.weekMinutes)} />
        <StatTile label="All time" value={formatMinutes(s.totalMinutes)} sub={`${s.completed} trees · ${s.withered} withered`} />
        <StatTile
          label="Best time"
          value={s.bestHour === null ? "—" : hourLabel(s.bestHour)}
          sub={s.longestMinutes ? `Longest ${formatMinutes(s.longestMinutes)}` : undefined}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
          <p className="mb-3 text-[13px] font-medium text-muted-foreground">Last 14 days</p>
          <div className="flex h-32 items-end gap-1.5">
            {s.days.map((d) => (
              <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${fromKey(d.date).toDateString()}: ${formatMinutes(d.minutes)}`}>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${(d.minutes / max) * 100}%` }}
                  transition={{ duration: 0.6, ease }}
                  className="min-h-[3px] rounded-md"
                  style={{ background: d.minutes ? HUE : "color-mix(in srgb, var(--foreground) 8%, transparent)" }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{fromKey(s.days[0].date).toLocaleDateString([], { day: "numeric", month: "short" })}</span>
            <span>Today</span>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
          <p className="mb-3 text-[13px] font-medium text-muted-foreground">By tag</p>
          {s.tags.length ? (
            <ul className="grid gap-2.5">
              {s.tags.slice(0, 6).map((t) => (
                <li key={t.tag || "untagged"} className="grid gap-1">
                  <span className="flex justify-between text-[13px]">
                    <span className="font-medium">{t.tag || "Untagged"}</span>
                    <span className="tabular-nums text-muted-foreground">{formatMinutes(t.minutes)}</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: HUE }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(t.minutes / maxTag) * 100}%` }}
                      transition={{ duration: 0.6, ease }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Tag sessions to see where your focus goes.</p>
          )}
        </div>
      </div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------

function UnlockDialog({ species, balance, onOpenChange }: { species: Species | null; balance: number; onOpenChange: (open: boolean) => void }) {
  const [, setSpecies] = usePref("focus.species");
  const unlock = useFocusMutation(async (key: string) => {
    await unlockSpecies(key);
    await setSpecies(key);
  });
  const enough = species ? balance >= species.cost : false;
  return (
    <Dialog open={!!species} onOpenChange={onOpenChange}>
      <DialogContent>
        {species ? (
          <>
            <DialogHeader>
              <DialogTitle>Unlock {species.name.toLowerCase()}</DialogTitle>
              <DialogDescription>
                {enough
                  ? `Costs ${species.cost} coins. You have ${balance}.`
                  : `Needs ${species.cost} coins; you have ${balance}. Every minute of finished focus earns a coin.`}
              </DialogDescription>
            </DialogHeader>
            <div className="grid place-items-center py-2">
              <Tree species={species.key} sway className="h-40 w-40" />
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                {enough ? "Not now" : "Close"}
              </Button>
              {enough ? (
                <Button
                  loading={unlock.isPending}
                  onClick={() =>
                    unlock.mutate(species.key, {
                      onSuccess: () => {
                        toast.success(`${species.name} unlocked`);
                        onOpenChange(false);
                      },
                    })
                  }
                >
                  <Coins />
                  Unlock for {species.cost}
                </Button>
              ) : null}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function FocusPage() {
  const focus = useFocus();
  const [shown, setShown] = useState<string | null>(null);
  const [locked, setLocked] = useState<Species | null>(null);
  const data = focus.data;
  const wallet = data ? coins(data.sessions, data.unlocks) : null;
  const unlocked = (s: Species) => (data ? isUnlocked(s, data.unlocks) : s.cost === 0);

  // The last session that ended on this page, until dismissed.
  const latest = data?.sessions[0];
  const result = !data?.active && latest && latest.id === shown ? latest : null;
  // Remember the active session, so its result shows when it ends here.
  if (data?.active && shown !== data.active.id) setShown(data.active.id);

  return (
    <Page hue={HUE}>
      <PageHeader
        title="Focus"
        description="Plant a tree, then stay with it until it grows."
        icon={mod.icon}
        hue={HUE}
        actions={
          wallet ? (
            <span
              className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold tabular-nums"
              style={{ background: `color-mix(in srgb, #e3a92b 16%, transparent)`, color: `color-mix(in srgb, #c8901a 85%, var(--foreground))` }}
              title="Focus coins: one per finished minute"
            >
              <Coins size={18} weight="fill" />
              {wallet.balance}
            </span>
          ) : null
        }
      />
      <div className="mt-8 grid gap-10">
        {!data ? (
          <Skeleton className="h-[420px] rounded-3xl" />
        ) : data.active ? (
          <RunningCard key={data.active.id} session={data.active} />
        ) : result ? (
          <ResultCard session={result} onDone={() => setShown(null)} />
        ) : (
          <SetupCard tags={data.tags} unlocked={unlocked} onLocked={setLocked} />
        )}
        {data ? <Forest sessions={data.sessions} /> : null}
        {data ? <Stats sessions={data.sessions} /> : null}
      </div>
      <UnlockDialog species={locked} balance={wallet?.balance ?? 0} onOpenChange={(open) => !open && setLocked(null)} />
    </Page>
  );
}
