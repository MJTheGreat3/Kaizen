import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { CalendarCheck, Fire, PencilSimple, SelectionAll, SelectionSlash, Snowflake, Trophy } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { EmptyState, PillToggle, SectionTitle } from "@/components/ui/kit";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { addDaysKey, formatLongDate, fromKey, relativeDay, todayKey, type DateKey } from "@/lib/dates";
import { ease, rise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { WEEKDAYS } from "@/modules/habits/streaks";
import { modules } from "@/modules/registry";
import { useActivity, useDayLog, useSaveRule, type TypeWithRule } from "./data";
import { amount, UNITS } from "./format";
import {
  activeDays,
  activeRate,
  levels,
  ruleLabel,
  streak,
  totalsByDay,
  weekColumns,
  type ActiveRule,
  type Streak,
} from "./logic";

const mod = modules.find((m) => m.id === "activity")!;
const HUE = mod.hue;

type Range = "3m" | "6m" | "year";
const RANGE_DAYS: Record<Range, number> = { "3m": 91, "6m": 182, year: 364 };

const unitOf = (t: TypeWithRule) => UNITS[t.id] ?? t.unit;

const LEVEL_MIX = [0, 32, 52, 74, 100];
const cellColor = (color: string, level: number) => `color-mix(in srgb, ${color} ${LEVEL_MIX[level]}%, var(--surface-muted))`;

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

function Heatmap({
  from,
  to,
  shown,
  levelsByType,
  selected,
  onSelect,
}: {
  from: DateKey;
  to: DateKey;
  shown: TypeWithRule[];
  levelsByType: Map<string, Map<DateKey, number>>;
  selected: DateKey;
  onSelect: (d: DateKey) => void;
}) {
  const cols = useMemo(() => weekColumns(from, to), [from, to]);
  const scroller = useRef<HTMLDivElement>(null);
  // Start scrolled to today on narrow screens.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [cols.length]);

  // A month's name above the week its first day falls in.
  const monthLabels = cols.map((col) => {
    const first = col.find((d) => d.endsWith("-01") && d >= from);
    return first ? fromKey(first).toLocaleDateString([], { month: "short" }) : "";
  });

  return (
    // The padding leaves room for the selection ring and hover zoom at the edges.
    <div ref={scroller} className="-m-2 overflow-x-auto p-2">
      <div className="inline-grid min-w-full gap-1" style={{ gridTemplateColumns: `24px repeat(${cols.length}, minmax(12px, 1fr))` }}>
        <span />
        {monthLabels.map((m, i) => (
          <span key={i} className="h-4 whitespace-nowrap text-[11px] text-muted-foreground">
            {m}
          </span>
        ))}
        {Array.from({ length: 7 }, (_, row) => (
          <Fragment key={row}>
            <span className="flex h-full items-center text-[10px] text-muted-foreground">{row % 2 === 0 ? WEEKDAYS[row].slice(0, 3) : ""}</span>
            {cols.map((col) => {
              const day = col[row];
              if (day < from || day > to) return <span key={day} />;
              const parts = shown
                .map((t) => ({ t, level: levelsByType.get(t.id)?.get(day) ?? 0 }))
                .filter((p) => p.level > 0)
                .sort((a, b) => b.level - a.level)
                .slice(0, 4);
              const background =
                parts.length === 0
                  ? "var(--surface-muted)"
                  : parts.length === 1
                    ? cellColor(parts[0].t.color, parts[0].level)
                    : `linear-gradient(90deg, ${parts
                        .map((p, i) => `${cellColor(p.t.color, p.level)} ${(i / parts.length) * 100}% ${((i + 1) / parts.length) * 100}%`)
                        .join(", ")})`;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelect(day)}
                  title={fromKey(day).toDateString()}
                  aria-label={`${formatLongDate(day)}: ${parts.length ? parts.map((p) => p.t.name).join(", ") : "nothing"}`}
                  className={cn(
                    "aspect-square w-full rounded-[3px] transition-transform hover:scale-125 focus-visible:outline-2 focus-visible:outline-offset-1",
                    day === selected && "ring-2 ring-foreground/70 ring-offset-1 ring-offset-surface",
                  )}
                  style={{ background }}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Day detail
// ---------------------------------------------------------------------------

function DayDetail({ date, types }: { date: DateKey; types: TypeWithRule[] }) {
  const log = useDayLog(date);
  const byType = new Map<string, { total: number; items: string[] }>();
  for (const item of log.data ?? []) {
    const entry = byType.get(item.typeId) ?? { total: 0, items: [] };
    entry.total += item.quantity;
    entry.items.push(item.label);
    byType.set(item.typeId, entry);
  }
  return (
    <motion.div
      key={date}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      className="rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5"
    >
      <p className="text-[15px] font-semibold tracking-tight">{relativeDay(date)}</p>
      <p className="text-[12px] text-muted-foreground">{formatLongDate(date)}</p>
      {log.isLoading ? (
        <Skeleton className="mt-3 h-16" />
      ) : byType.size ? (
        <ul className="mt-3 grid gap-3">
          {types
            .filter((t) => byType.has(t.id))
            .map((t) => {
              const entry = byType.get(t.id)!;
              return (
                <li key={t.id} className="grid gap-1">
                  <span className="flex items-center gap-2 text-[14px] font-medium">
                    <span className="size-2.5 rounded-full" style={{ background: t.color }} />
                    {t.name}
                    <span className="font-normal text-muted-foreground">· {amount(t.id, entry.total)}</span>
                  </span>
                  <span className="pl-4.5 text-[13px] leading-relaxed text-muted-foreground">{[...new Set(entry.items)].join(", ")}</span>
                </li>
              );
            })}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-muted-foreground">Nothing recorded this day.</p>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

function StreakCard({
  label,
  color,
  s,
  rate,
  rule,
  onEdit,
  big,
}: {
  label: string;
  color: string;
  s: Streak;
  rate: number;
  rule?: string;
  onEdit?: () => void;
  big?: boolean;
}) {
  const unit = s.unit === "weeks" ? (s.current === 1 ? "week" : "weeks") : s.current === 1 ? "day" : "days";
  return (
    <motion.div
      variants={rise}
      className={cn("relative overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-soft", big && "md:col-span-2")}
    >
      <div
        aria-hidden
        className="absolute -right-10 -top-10 size-32 rounded-full opacity-60 blur-2xl"
        style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}
      />
      <div className="relative flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
          <span className="size-2.5 rounded-full" style={{ background: color }} />
          {label}
        </span>
        {onEdit ? (
          <button type="button" aria-label={`Edit ${label} rule`} onClick={onEdit} className="rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-foreground">
            <PencilSimple size={15} />
          </button>
        ) : null}
      </div>
      <div className="relative mt-2 flex items-end gap-2">
        <Fire size={big ? 30 : 24} weight={s.current ? "fill" : "regular"} style={{ color: s.current ? color : "var(--muted-foreground)" }} />
        <span className={cn("font-semibold leading-none tracking-[-0.03em] tabular-nums", big ? "text-[40px]" : "text-[30px]")}>{s.current}</span>
        <span className="pb-1 text-[13px] text-muted-foreground">{unit}</span>
      </div>
      <p className="relative mt-2 text-[12px] text-muted-foreground">
        {s.current && !s.doneNow ? (s.unit === "weeks" ? "Not done this week yet · " : "Not done today yet · ") : ""}
        Best {s.longest} · {Math.round(rate * 100)}% of days
      </p>
      {rule ? <p className="relative mt-0.5 text-[11px] text-muted-foreground/80">{rule}</p> : null}
    </motion.div>
  );
}

function RuleDialog({ type, onOpenChange }: { type: TypeWithRule | null; onOpenChange: (open: boolean) => void }) {
  const save = useSaveRule();
  const [draft, setDraft] = useState<ActiveRule | null>(null);
  const rule = draft ?? type?.rule ?? null;
  const set = (patch: Partial<ActiveRule>) => rule && setDraft({ ...rule, ...patch });
  const close = (open: boolean) => {
    if (!open) setDraft(null);
    onOpenChange(open);
  };
  return (
    <Dialog open={!!type} onOpenChange={close}>
      <DialogContent>
        {type && rule ? (
          <>
            <DialogHeader>
              <DialogTitle>{type.name} streak</DialogTitle>
              <DialogDescription>What counts as an active day, and what keeps a streak alive.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <Segmented
                label="Count streak in"
                value={rule.period}
                onChange={(period) => set({ period })}
                options={[
                  { value: "day", label: "Days" },
                  { value: "week", label: "Weeks" },
                ]}
              />
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Active day: at least (${unitOf(type) ?? "amount"})`} htmlFor="rule-min">
                  <Input id="rule-min" type="number" min={1} value={rule.min} onChange={(e) => set({ min: Math.max(1, Number(e.target.value) || 1) })} />
                </Field>
                {rule.period === "week" ? (
                  <Field label="Active days per week" htmlFor="rule-week">
                    <Input id="rule-week" type="number" min={1} max={7} value={rule.perWeek} onChange={(e) => set({ perWeek: Math.min(7, Math.max(1, Number(e.target.value) || 1)) })} />
                  </Field>
                ) : (
                  <Field label="Streak freezes per month" htmlFor="rule-freeze">
                    <Input id="rule-freeze" type="number" min={0} max={10} value={rule.freezesPerMonth} onChange={(e) => set({ freezesPerMonth: Math.min(10, Math.max(0, Number(e.target.value) || 0)) })} />
                  </Field>
                )}
              </div>
              {rule.period === "day" ? (
                <div className="grid gap-2">
                  <span className="text-[13px] font-medium">Rest days (never break the streak)</span>
                  <PillToggle
                    label="Rest days"
                    value={rule.restDays}
                    onChange={(restDays) => set({ restDays })}
                    options={WEEKDAYS.map((w, i) => ({ value: i + 1, label: w.slice(0, 3) }))}
                  />
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                loading={save.isPending}
                onClick={() =>
                  save.mutate(
                    { typeId: type.id, rule },
                    {
                      onSuccess: () => {
                        toast.success("Streak rule saved");
                        close(false);
                      },
                    },
                  )
                }
              >
                Save
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

export function ActivityPage() {
  const activity = useActivity();
  const [range, setRange] = useState<Range>("6m");
  const [hidden, setHidden] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [selected, setSelected] = useState<DateKey>(todayKey());
  const [editing, setEditing] = useState<TypeWithRule | null>(null);
  const today = todayKey();
  const from = addDaysKey(today, -RANGE_DAYS[range]);

  const view = useMemo(() => {
    const data = activity.data;
    if (!data) return null;
    const events = tag ? data.events.filter((ev) => data.tags.get(ev.id)?.includes(tag)) : data.events;
    const totals = totalsByDay(events);
    const withData = new Set(events.map((ev) => ev.typeId));
    const types = data.types;
    const shown = types.filter((t) => !hidden.includes(t.id));
    const levelsByType = new Map(shown.map((t) => [t.id, levels(totals.get(t.id), from, today)]));
    const perType = types.map((t) => {
      const active = activeDays(totals.get(t.id), t.rule);
      let total = 0;
      for (const [d, q] of totals.get(t.id) ?? []) if (d >= from && d <= today) total += q;
      return { t, active, total, s: streak(active, t.rule, today), rate: activeRate(active, from, today) };
    });
    const anyActive = new Set(perType.filter((p) => !hidden.includes(p.t.id)).flatMap((p) => [...p.active]));
    const overall = streak(anyActive, { period: "day", min: 1, perWeek: 1, restDays: [], freezesPerMonth: 0 }, today);
    const daysWithAny = new Set([...levelsByType.values()].flatMap((l) => [...l.keys()])).size;
    return { types, shown, withData, daysWithAny, levelsByType, perType, overall, overallRate: activeRate(anyActive, from, today), anyActive };
  }, [activity.data, hidden, tag, from, today]);

  const toggle = (id: string) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  const only = view?.shown.length === 1 ? view.shown[0] : null;

  return (
    <Page hue={HUE}>
      <PageHeader
        title="Activity"
        description="Everything you do, day by day."
        icon={mod.icon}
        hue={HUE}
        actions={
          view ? (
            <span
              className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold tabular-nums"
              style={{ background: `color-mix(in srgb, ${HUE} 14%, transparent)`, color: `color-mix(in srgb, ${HUE} 80%, var(--foreground))` }}
              title="Days in a row with any activity"
            >
              <Fire size={18} weight="fill" />
              {view.overall.current} {view.overall.current === 1 ? "day" : "days"}
            </span>
          ) : null
        }
      />

      <div className="mt-8 grid gap-8">
        {!view ? (
          <Skeleton className="h-[320px] rounded-3xl" />
        ) : (
          <>
            <motion.section variants={rise} className="grid gap-4 rounded-3xl border border-border bg-surface p-4 shadow-soft md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Activity types">
                  {view.types.map((t) => {
                    const on = !hidden.includes(t.id);
                    const empty = !view.withData.has(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggle(t.id)}
                        onDoubleClick={() => setHidden(view.types.filter((x) => x.id !== t.id).map((x) => x.id))}
                        title={empty ? "Nothing recorded yet" : "Click to toggle, double-click to show only this"}
                        className={cn(
                          "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-95",
                          on ? "border-transparent" : "border-border text-muted-foreground",
                          empty && "opacity-50",
                        )}
                        style={on ? { background: `color-mix(in srgb, ${t.color} 16%, transparent)`, color: `color-mix(in srgb, ${t.color} 80%, var(--foreground))` } : undefined}
                      >
                        <span className="size-2 rounded-full" style={{ background: on ? t.color : "var(--muted-foreground)" }} />
                        {t.name}
                      </button>
                    );
                  })}
                  {[
                    { label: "Show all", icon: SelectionAll, onClick: () => setHidden([]), off: hidden.length === 0 },
                    { label: "Hide all", icon: SelectionSlash, onClick: () => setHidden(view.types.map((t) => t.id)), off: view.shown.length === 0 },
                  ].map(({ label, icon: Icon, onClick, off }) => (
                    <button
                      key={label}
                      type="button"
                      aria-label={label}
                      title={label}
                      disabled={off}
                      onClick={onClick}
                      className="grid size-8 place-items-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground active:scale-95 disabled:opacity-40 disabled:hover:text-muted-foreground"
                    >
                      <Icon size={16} />
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {activity.data?.allTags.length ? (
                    <NativeSelect aria-label="Tag" value={tag} onChange={(e) => setTag(e.target.value)}>
                      <option value="">All tags</option>
                      {activity.data.allTags.map((x) => (
                        <option key={x} value={x}>
                          #{x}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                  <Segmented
                    label="Range"
                    value={range}
                    onChange={setRange}
                    options={[
                      { value: "3m", label: "3M" },
                      { value: "6m", label: "6M" },
                      { value: "year", label: "Year" },
                    ]}
                  />
                </div>
              </div>

              <Heatmap from={from} to={today} shown={view.shown} levelsByType={view.levelsByType} selected={selected} onSelect={setSelected} />

              <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted-foreground">
                <span>
                  {view.daysWithAny ? `${view.daysWithAny} days with activity` : "No activity yet"} · tap a day for details
                </span>
                <span className="flex items-center gap-1.5">
                  Less
                  {[0, 1, 2, 3, 4].map((l) => (
                    <span key={l} className="size-3 rounded-[3px]" style={{ background: l ? cellColor(only?.color ?? HUE, l) : "var(--surface-muted)" }} />
                  ))}
                  More
                </span>
              </div>
            </motion.section>

            <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
              <AnimatePresence mode="wait">
                <DayDetail key={selected} date={selected} types={view.types} />
              </AnimatePresence>
              <motion.div variants={rise} className="rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
                <p className="text-[15px] font-semibold tracking-tight">In this range</p>
                <ul className="mt-3 grid gap-2.5">
                  {view.perType
                    .filter((p) => !hidden.includes(p.t.id) && p.total > 0)
                    .map((p) => (
                      <li key={p.t.id} className="flex items-center justify-between gap-3 text-[13px]">
                        <span className="flex items-center gap-2 font-medium">
                          <span className="size-2.5 rounded-full" style={{ background: p.t.color }} />
                          {p.t.name}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {amount(p.t.id, p.total)} · {[...p.active].filter((d) => d >= from).length} days
                        </span>
                      </li>
                    ))}
                  {view.perType.every((p) => hidden.includes(p.t.id) || p.total === 0) ? (
                    <li className="text-[13px] text-muted-foreground">Nothing in this range yet.</li>
                  ) : null}
                </ul>
              </motion.div>
            </div>

            <section>
              <SectionTitle>Streaks</SectionTitle>
              {view.anyActive.size ? (
                <motion.div variants={rise} className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StreakCard label="Any activity" color={HUE} s={view.overall} rate={view.overallRate} big />
                  {view.perType
                    .filter((p) => !hidden.includes(p.t.id) && view.withData.has(p.t.id))
                    .map((p) => (
                      <StreakCard
                        key={p.t.id}
                        label={p.t.name}
                        color={p.t.color}
                        s={p.s}
                        rate={p.rate}
                        rule={ruleLabel(p.t.rule, unitOf(p.t))}
                        onEdit={() => setEditing(p.t)}
                      />
                    ))}
                </motion.div>
              ) : (
                <EmptyState icon={CalendarCheck} hue={HUE} title="Your streaks start here">
                  Finish a task, tick a habit, mark a class or grow a tree, and it shows up on the heatmap.
                </EmptyState>
              )}
              <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Trophy size={14} /> Milestones at 7, 30, 100 and 365
                </span>
                <span className="flex items-center gap-1">
                  <Snowflake size={14} /> Rest days and freezes per activity (pencil icon)
                </span>
              </p>
            </section>
          </>
        )}
      </div>
      <RuleDialog type={editing} onOpenChange={(open) => !open && setEditing(null)} />
    </Page>
  );
}
