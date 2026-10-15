import { useMemo, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ArrowDown, ArrowUp, CaretLeft, CaretRight } from "@phosphor-icons/react";

import { Segmented, Skeleton } from "@/components/ui/controls";
import { ProgressRing } from "@/components/ui/ring";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { formatLongDate, fromKey, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { modules } from "@/modules/registry";
import { useReview, type PeriodStats } from "./data";
import { days, delta, hoursMinutes, periodLabel, periodOf, shift, type PeriodKind } from "./logic";

const mod = modules.find((m) => m.id === "review")!;

function Tile({
  label,
  value,
  sub,
  change,
}: {
  label: string;
  value: string;
  sub?: string;
  change?: ReturnType<typeof delta>;
}) {
  return (
    <motion.div variants={rise} className="border-border bg-surface shadow-soft rounded-2xl border p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-[12px] font-medium">{label}</p>
        {change ? (
          <span
            className={cn(
              "flex items-center gap-0.5 text-[11px] font-semibold tabular-nums",
              change.up ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {change.up ? <ArrowUp size={11} weight="bold" /> : <ArrowDown size={11} weight="bold" />}
            {change.text}
          </span>
        ) : null}
      </div>
      <p className="mt-1 truncate text-[22px] leading-none font-semibold tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="text-muted-foreground mt-1 truncate text-[12px]">{sub}</p> : null}
    </motion.div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <motion.section variants={rise} className="border-border bg-surface shadow-soft rounded-2xl border p-4 md:p-5">
      <h2 className="mb-3 text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </motion.section>
  );
}

/** One sentence for the period, from whatever happened in it. */
function summaryLine(s: PeriodStats): string {
  const parts = [
    s.workouts ? `worked out ${s.workouts === 1 ? "once" : `${s.workouts} times`}` : null,
    s.focusMinutes >= 1 ? `focused for ${hoursMinutes(s.focusMinutes)}` : null,
    s.problems ? `solved ${s.problems} ${s.problems === 1 ? "problem" : "problems"}` : null,
    s.tasksDone ? `finished ${s.tasksDone} ${s.tasksDone === 1 ? "task" : "tasks"}` : null,
    s.musicMinutes >= 30 ? `listened to ${hoursMinutes(s.musicMinutes)} of music` : null,
  ].filter(Boolean) as string[];
  if (!parts.length) return "A quiet stretch. Everything you log shows up here.";
  const last = parts.pop();
  return `You ${parts.length ? `${parts.join(", ")} and ${last}` : last}.`;
}

/** The week or month at a glance, against the one before. */
export function ReviewPage() {
  const [kind, setKind] = useState<PeriodKind>("week");
  const [offset, setOffset] = useState(0);
  const today = todayKey();
  const period = useMemo(() => shift(periodOf(kind, today), offset), [kind, offset, today]);
  const { data, isLoading } = useReview(period);
  const all = days(period);
  const elapsed = all.filter((d) => d <= today).length;
  const name = kind === "week" ? "week" : "month";

  const c = data?.current;
  const p = data?.previous;
  const typeById = new Map((data?.types ?? []).map((t) => [t.id, t]));
  const maxDay = Math.max(
    1,
    ...all.map((d) => [...(c?.activity.perDay.get(d)?.values() ?? [])].reduce((a, b) => a + b, 0)),
  );

  return (
    <Page hue={mod.hue} className="max-w-[1000px]">
      <PageHeader
        title="Review"
        description={`Your ${name} at a glance, against the ${name} before.`}
        icon={mod.icon}
        hue={mod.hue}
      />

      <motion.div variants={rise} className="mt-6 flex flex-wrap items-center gap-3">
        <Segmented
          label="Period"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setOffset(0);
          }}
          options={[
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Previous ${name}`}
            onClick={() => setOffset((o) => o - 1)}
            className="hover:bg-surface-muted grid size-9 place-items-center rounded-lg"
          >
            <CaretLeft size={16} />
          </button>
          <span className="min-w-36 text-center text-[15px] font-semibold tabular-nums">{periodLabel(period)}</span>
          <button
            type="button"
            aria-label={`Next ${name}`}
            disabled={offset >= 0}
            onClick={() => setOffset((o) => o + 1)}
            className="hover:bg-surface-muted grid size-9 place-items-center rounded-lg disabled:opacity-30"
          >
            <CaretRight size={16} />
          </button>
        </div>
        {offset !== 0 ? (
          <button
            type="button"
            onClick={() => setOffset(0)}
            className="text-muted-foreground hover:text-foreground text-[13px] font-medium"
          >
            This {name}
          </button>
        ) : null}
      </motion.div>

      {isLoading || !c || !p ? (
        <Skeleton className="mt-6 h-72 rounded-2xl" />
      ) : (
        <div className="mt-6 grid gap-4">
          <motion.section
            variants={rise}
            className="border-border bg-surface shadow-soft relative overflow-hidden rounded-2xl border p-5 md:p-6"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${mod.hue} 16%, transparent), transparent 60%)`,
              }}
            />
            <div className="relative flex items-center gap-5">
              <ProgressRing value={elapsed ? c.activity.activeDays / elapsed : 0} hue={mod.hue} size={84} stroke={8}>
                <span className="text-center leading-none">
                  <span className="block text-[22px] font-bold tabular-nums">{c.activity.activeDays}</span>
                  <span className="text-muted-foreground text-[11px]">of {elapsed}</span>
                </span>
              </ProgressRing>
              <div className="grid min-w-0 gap-1">
                <p className="text-muted-foreground text-[13px] font-medium">
                  Active on {c.activity.activeDays} of {elapsed} {elapsed === 1 ? "day" : "days"}
                  {delta(c.activity.activeDays, p.activity.activeDays)
                    ? ` (${delta(c.activity.activeDays, p.activity.activeDays)!.text} on last ${name})`
                    : ""}
                </p>
                <p className="text-[18px] leading-snug font-semibold tracking-tight md:text-[20px]">{summaryLine(c)}</p>
              </div>
            </div>
          </motion.section>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Tasks done" value={String(c.tasksDone)} change={delta(c.tasksDone, p.tasksDone)} />
            <Tile
              label="Habits"
              value={c.habits === null ? "–" : `${Math.round(c.habits * 100)}%`}
              sub="of planned check-ins"
              change={
                c.habits !== null && p.habits !== null
                  ? delta(Math.round(c.habits * 100), Math.round(p.habits * 100))
                  : null
              }
            />
            <Tile
              label="Focus"
              value={hoursMinutes(c.focusMinutes)}
              sub={`${c.focusSessions} ${c.focusSessions === 1 ? "tree" : "trees"} grown`}
              change={delta(c.focusMinutes, p.focusMinutes, true)}
            />
            <Tile
              label="Gym"
              value={`${c.workouts} ${c.workouts === 1 ? "workout" : "workouts"}`}
              sub={c.volume ? `${Math.round(c.volume).toLocaleString()} kg lifted` : undefined}
              change={delta(c.workouts, p.workouts)}
            />
            <Tile label="Problems solved" value={String(c.problems)} change={delta(c.problems, p.problems)} />
            <Tile
              label="Music"
              value={hoursMinutes(c.musicMinutes)}
              sub={c.topArtist ? `Mostly ${c.topArtist.name}` : undefined}
              change={delta(c.musicMinutes, p.musicMinutes, true)}
            />
            <Tile
              label="Sports"
              value={hoursMinutes(c.sportsMinutes)}
              change={delta(c.sportsMinutes, p.sportsMinutes, true)}
            />
            <Tile label="Ideas and boards" value={`${c.ideas} · ${c.boards}`} sub="ideas · boards made" />
          </div>

          <Card title="Day by day">
            <div
              className={cn("flex h-36 items-end", all.length > 7 ? "gap-[3px]" : "gap-2")}
              role="img"
              aria-label="Activity per day"
            >
              {all.map((d) => {
                const types = c.activity.perDay.get(d);
                const total = [...(types?.values() ?? [])].reduce((a, b) => a + b, 0);
                return (
                  <div
                    key={d}
                    className="flex h-full min-w-0 flex-1 flex-col justify-end"
                    title={`${formatLongDate(d)}: ${total} logged`}
                  >
                    <div
                      className="flex flex-col-reverse overflow-hidden rounded-t-md"
                      style={{ height: `${(total / maxDay) * 100}%`, minHeight: total ? 3 : 2 }}
                    >
                      {total ? (
                        [...types!].map(([type, n]) => (
                          <span
                            key={type}
                            style={{
                              height: `${(n / total) * 100}%`,
                              background: typeById.get(type)?.color ?? "var(--muted-foreground)",
                            }}
                          />
                        ))
                      ) : (
                        <span className={cn("h-full", d > today ? "bg-transparent" : "bg-surface-muted")} />
                      )}
                    </div>
                    {all.length <= 7 || fromKey(d).getDate() % 5 === 1 ? (
                      <span className="text-muted-foreground mt-1 truncate text-center text-[10px]">
                        {all.length <= 7
                          ? fromKey(d).toLocaleDateString([], { weekday: "short" })
                          : fromKey(d).getDate()}
                      </span>
                    ) : (
                      <span className="mt-1 h-[15px]" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {[...c.activity.counts]
                .sort((a, b) => b[1] - a[1])
                .map(([type, n]) => (
                  <span key={type} className="flex items-center gap-1.5 text-[12px]">
                    <span className="size-2.5 rounded-[3px]" style={{ background: typeById.get(type)?.color }} />
                    {typeById.get(type)?.name ?? type}
                    <span className="text-muted-foreground tabular-nums">{n}</span>
                  </span>
                ))}
            </div>
          </Card>

          <Card title="Highlights">
            <ul className="grid gap-2 text-[14px]">
              {c.activity.bestDay ? (
                <li>
                  <b>Best day:</b> {formatLongDate(c.activity.bestDay.day)}, with {c.activity.bestDay.count}{" "}
                  {c.activity.bestDay.count === 1 ? "thing" : "things"} logged.
                </li>
              ) : null}
              {c.longestFocus >= 1 ? (
                <li>
                  <b>Longest focus:</b> {hoursMinutes(c.longestFocus)} in one sitting.
                </li>
              ) : null}
              {c.topSong ? (
                <li>
                  <b>On repeat:</b> {c.topSong.title} by {c.topSong.artist}, {c.topSong.plays} plays.
                </li>
              ) : null}
              {c.booksFinished.length ? (
                <li>
                  <b>Finished reading:</b> {c.booksFinished.join(", ")}.
                </li>
              ) : null}
              {!c.activity.bestDay && c.longestFocus < 1 && !c.topSong && !c.booksFinished.length ? (
                <li className="text-muted-foreground">Nothing stands out yet this {name}.</li>
              ) : null}
            </ul>
          </Card>
        </div>
      )}
    </Page>
  );
}
