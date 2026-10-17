import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarBlank,
  Flag,
  HandCoins,
  Hourglass,
  GridFour,
  BookOpen,
  ListChecks,
  Plus,
  Target,
  Trophy,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { CheckCircle, Chip } from "@/components/ui/kit";
import { ProgressRing } from "@/components/ui/ring";
import { ModuleTile, Sky, Wash } from "@/components/visual";
import { notificationsAllowed, requestNotifications, syncNotifications } from "@/core/notifications/scheduler";
import { parseTask } from "@/core/nl/parse";
import { useSession } from "@/core/security/session";
import { formatMinutes, relativeDay, timeToMinutes, todayKey } from "@/lib/dates";
import { rise, stagger } from "@/lib/motion";
import { formatPaise } from "@/lib/money";
import { formatClock, formatDayMonth, formatWeekday, greeting, useNow } from "@/lib/time";
import { cn, timeUntil } from "@/lib/utils";
import { dayOff, occurrencesOn } from "@/modules/calendar/attendance";
import { ClassList } from "@/modules/calendar/ClassList";
import { loadCalendar, loadDates, upcomingDates } from "@/modules/calendar/data";
import { DATE_STYLE } from "@/modules/calendar/labels";
import { totals } from "@/modules/debts/balances";
import { loadDebts } from "@/modules/debts/data";
import { loadHabits, logHabit } from "@/modules/habits/data";
import { isDone, isScheduled } from "@/modules/habits/streaks";
import { loadTasks, setTaskDone, useAddTask } from "@/modules/lists/data";
import { ReadingGlance } from "@/modules/lists/ReadingSession";
import { modules } from "@/modules/registry";
import { ActivityGlance } from "@/modules/activity/Glance";
import { useGoals } from "@/modules/goals/data";
import { activeGoals } from "@/modules/goals/format";
import { GoalsGlance } from "@/modules/goals/Glance";
import { loadContests } from "@/modules/practice/data";
import { loadMatches } from "@/modules/sports/data";
import { Avatar } from "@/modules/sports/parts";
import { platformOf } from "@/modules/practice/logic";
import { getPref } from "@/core/db/prefs";
import { openUrl } from "@/lib/native";

/** Module routes are built from the registry, so their paths are plain strings. */
const CALENDAR_PATH: string = "/calendar";

const hueOf = (id: string) => modules.find((m) => m.id === id)?.hue ?? "var(--accent)";

async function loadToday() {
  const [tasks, habits, calendar, dates, debts, contests, contestPlatforms, games] = await Promise.all([
    loadTasks("todo"),
    loadHabits(14),
    loadCalendar(),
    loadDates(),
    loadDebts(),
    loadContests(),
    getPref("practice.contestPlatforms"),
    loadMatches(),
  ]);
  // Contests in the next week on the sites chosen in Practice.
  const soon = contests.filter((c) => contestPlatforms.includes(c.platform) && c.startAt < Date.now() + 7 * 86_400_000).slice(0, 3);
  // Followed teams' games that are live or start within two days.
  const matches = games.filter((g) => g.startAt < Date.now() + 2 * 86_400_000).slice(0, 3);
  return { tasks, habits, calendar, dates, debts, contests: soon, matches };
}

/**
 * When an Up next item happens, the same way for everything: "Live",
 * "in 3 h 20 min" within twelve hours, otherwise "Thu 15 Oct, 7:30 pm".
 * Dates without a time read "Today" or "Sat 17 Oct".
 */
function upNextWhen(at: number, now: number, { live, allDay }: { live: boolean; allDay: boolean }) {
  if (live) return "Live";
  const d = new Date(at);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const day = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
  if (allDay) return todayKey(d) === todayKey(new Date(now)) ? "Today" : day;
  if (at - now <= 12 * 3_600_000) return timeUntil(at, now);
  return `${day}, ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function Card({ to, title, icon, hue, className, children, action }: { to: string; title: string; icon: Icon; hue: string; className?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <motion.section variants={rise} className={cn("relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-soft", className)}>
      <div aria-hidden className="pointer-events-none absolute -left-10 -top-16 size-48 rounded-full opacity-60 blur-2xl" style={{ background: `color-mix(in srgb, ${hue} 14%, transparent)` }} />
      <div className="relative flex items-center justify-between gap-2">
        <Link to={to} className="group flex items-center gap-2.5">
          <ModuleTile icon={icon} hue={hue} size="sm" />
          <span className="text-[14px] font-semibold tracking-tight">{title}</span>
          <ArrowUpRight size={14} className="text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </Link>
        {action}
      </div>
      <div className="relative mt-4 flex flex-1 flex-col">{children}</div>
    </motion.section>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-[14px] leading-relaxed text-muted-foreground">{children}</p>;
}

function QuickTask() {
  const add = useAddTask();
  const [text, setText] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const parsed = parseTask(text, new Date(), "todo");
    await add.mutateAsync({ ...parsed, dueDate: parsed.dueDate ?? todayKey() });
    setText("");
  }
  return (
    <form onSubmit={submit} className="mt-3 flex items-center gap-2 rounded-xl bg-surface-muted px-3">
      <Plus size={16} className="text-muted-foreground" />
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a task for today" enterKeyHint="done" className="h-10 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
    </form>
  );
}

export function TodayPage() {
  const now = useNow(30_000);
  const today = todayKey(now);
  const minutes = now.getHours() * 60 + now.getMinutes();
  const info = useSession((s) => s.info);
  const client = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["today"], queryFn: loadToday });
  const goals = activeGoals(useGoals().data);
  const allowed = useQuery({ queryKey: ["notify-allowed"], queryFn: notificationsAllowed });
  const refresh = () => {
    client.invalidateQueries({ queryKey: ["today"] });
    client.invalidateQueries({ queryKey: ["tasks"] });
    client.invalidateQueries({ queryKey: ["habits"] });
  };
  const toggleTask = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => setTaskDone(data!.tasks.find((t) => t.id === id)!, done),
    onSuccess: refresh,
  });
  const toggleHabit = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => logHabit(data!.habits.habits.find((h) => h.id === id)!, today, value),
    onSuccess: refresh,
  });
  const enable = useMutation({
    mutationFn: requestNotifications,
    onSuccess: async (granted) => {
      client.setQueryData(["notify-allowed"], granted);
      if (granted) await syncNotifications(info?.platform === "android" ? "android" : "desktop");
    },
  });

  const cal = data?.calendar;
  const semester = cal?.semester ?? null;
  const classes = semester ? occurrencesOn(semester, cal!.slots, cal!.exceptions, today) : [];
  const off = semester ? dayOff(cal!.exceptions, today) : null;
  const marks = new Map((cal?.marks ?? []).map((m) => [m.classKey, m.status]));
  const tasks = (data?.tasks ?? [])
    .filter((t) => t.status !== "done" && t.dueDate && t.dueDate <= today)
    .sort((a, b) => (a.dueDate !== b.dueDate ? (a.dueDate! < b.dueDate! ? -1 : 1) : (a.dueTime ?? "99") < (b.dueTime ?? "99") ? -1 : 1));
  const doneToday = (data?.tasks ?? []).filter((t) => t.status === "done" && t.completedAt && todayKey(new Date(t.completedAt)) === today);
  const habits = (data?.habits.habits ?? []).filter((h) => h.schedule.type === "weekly" || isScheduled(h, today));
  const habitsDone = habits.filter((h) => isDone(h, data!.habits.values.get(h.id)?.get(today))).length;
  const upcoming = data ? upcomingDates(data.dates, today, 14).slice(0, 4) : [];
  const debtTotals = data ? totals(data.debts.balance) : null;
  const topDebts = data
    ? data.debts.people
        .map((p) => ({ p, b: data.debts.balance.get(p.id) ?? 0 }))
        .filter((x) => x.b !== 0)
        .sort((a, b) => Math.abs(b.b) - Math.abs(a.b))
        .slice(0, 3)
    : [];
  const liveClasses = classes.filter((o) => !o.cancelled);
  const left = habits.length - habitsDone;
  const summary = [
    liveClasses.length ? `${liveClasses.length} ${liveClasses.length === 1 ? "class" : "classes"}` : null,
    tasks.length ? `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}` : null,
    left ? `${left} ${left === 1 ? "habit" : "habits"} to go` : null,
  ].filter(Boolean);

  return (
    <div className="relative">
      <Wash hue={hueOf("today")} />
      <motion.div variants={stagger} initial="hidden" animate="show" className="relative mx-auto grid w-full max-w-[1080px] gap-4 px-4 py-5 md:px-10 md:py-10">
        <motion.div variants={rise}>
          <Sky className="min-h-[220px] rounded-3xl shadow-float md:min-h-[250px]">
            <div className="flex h-full min-h-[220px] flex-col justify-between p-6 text-white md:min-h-[250px] md:p-8">
              <div className="flex items-start justify-between gap-4">
                <p className="text-[15px] font-medium text-white/85">{greeting(now)}</p>
                <p className="text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-white/90 md:text-[30px]">{formatClock(now)}</p>
              </div>
              <div>
                <p className="text-[40px] font-semibold leading-none tracking-[-0.035em] md:text-[56px]">{formatWeekday(now)}</p>
                <p className="mt-2 text-[16px] font-medium text-white/85 md:text-[18px]">
                  {formatDayMonth(now)}
                  {data ? <span className="text-white/70">{summary.length ? `, ${summary.join(", ")}` : ", nothing pressing"}</span> : null}
                </p>
              </div>
            </div>
          </Sky>
        </motion.div>

        {allowed.data === false ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-4 shadow-soft">
            <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-soft-foreground">
              <Bell size={20} weight="duotone" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold">Turn on reminders</p>
              <p className="text-[13px] text-muted-foreground">Class alerts, attendance checks, tasks, habits, dates, contests and games.</p>
            </div>
            <Button size="sm" loading={enable.isPending} onClick={() => enable.mutate()}>
              Turn on
            </Button>
          </motion.div>
        ) : null}

        {isLoading || !data ? (
          <div className="grid gap-4 md:grid-cols-6">
            <Skeleton className="h-72 rounded-2xl md:col-span-4" />
            <Skeleton className="h-72 rounded-2xl md:col-span-2" />
          </div>
        ) : (
          <motion.div variants={stagger} initial="hidden" animate="show" className="grid gap-4 md:grid-cols-6">
            <Card to="/calendar" title="Classes today" icon={CalendarBlank} hue={hueOf("calendar")} className="md:col-span-4 md:row-span-2">
              {!semester ? (
                <div className="flex flex-1 flex-col items-start justify-center gap-3">
                  <Muted>Set up your semester and weekly timetable to see classes here and mark attendance in one tap.</Muted>
                  <Button asChild size="sm" variant="secondary">
                    <Link to={CALENDAR_PATH}>
                      Set up timetable <ArrowRight />
                    </Link>
                  </Button>
                </div>
              ) : off ? (
                <Muted>{off.title ?? "Holiday"}. No classes today.</Muted>
              ) : !classes.length ? (
                <Muted>No classes today.</Muted>
              ) : (
                <ClassList occurrences={classes} subjects={cal!.subjects} marks={marks} semester={semester} now={{ day: today, minutes }} compact />
              )}
            </Card>

            <Card
              to="/habits"
              title="Habits"
              icon={Target}
              hue={hueOf("habits")}
              className="md:col-span-2"
              action={
                habits.length ? (
                  <ProgressRing value={habitsDone / habits.length} hue={hueOf("habits")} size={30} stroke={4}>
                    <span className="text-[9px] font-bold tabular-nums">{habitsDone}</span>
                  </ProgressRing>
                ) : null
              }
            >
              {!habits.length ? (
                <Muted>No habits for today.</Muted>
              ) : (
                <ul className="grid gap-1">
                  {habits.map((h) => {
                    const value = data.habits.values.get(h.id)?.get(today) ?? 0;
                    const done = isDone(h, value);
                    return (
                      <li key={h.id} className="flex items-center gap-3 py-1.5">
                        <CheckCircle
                          checked={done}
                          hue={h.color}
                          label={`${h.name}${h.kind === "count" ? ` (${value} of ${h.target})` : ""}`}
                          onChange={() => toggleHabit.mutate({ id: h.id, value: h.kind === "check" ? (done ? 0 : 1) : done ? 0 : Math.min(h.target, value + 1) })}
                        />
                        <span className={cn("min-w-0 flex-1 truncate text-[14px]", done && "text-muted-foreground line-through")}>{h.name}</span>
                        {h.kind === "count" ? (
                          <span className="text-[12px] tabular-nums text-muted-foreground">
                            {value}/{h.target}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card to="/calendar" title="Up next" icon={Hourglass} hue={hueOf("practice")} className="md:col-span-2">
              {!upcoming.length && !data.contests.length && !data.matches.length ? (
                <Muted>Nothing in the next two weeks. Contests and matches will appear here too.</Muted>
              ) : (
                // One shrinkable column, so long names truncate instead of pushing the times out.
                <ul className="grid min-w-0 grid-cols-1 gap-2.5">
                  {[
                    ...data.matches.map((g) => ({
                      key: `m:${g.id}`,
                      at: g.startAt,
                      live: g.state === "in",
                      allDay: false,
                      title: `${g.homeShort || g.home} v ${g.awayShort || g.away}`,
                      icon: <Avatar src={g.homeLogo} name={g.home} square className="size-[18px] text-[8px]" />,
                      open: g.url ? () => void openUrl(g.url!) : undefined,
                    })),
                    ...data.contests.map((c) => ({
                      key: `c:${c.id}`,
                      at: c.startAt,
                      live: c.startAt <= now.getTime(),
                      allDay: false,
                      title: c.name,
                      icon: <Trophy size={18} weight="duotone" style={{ color: platformOf(c.platform)?.color }} />,
                      open: () => void openUrl(c.url),
                    })),
                    ...upcoming.map(({ item, date }) => {
                      const st = DATE_STYLE[item.kind] ?? DATE_STYLE.other;
                      return {
                        key: `d:${item.id}`,
                        at: new Date(`${date}T00:00:00`).getTime(),
                        live: false,
                        allDay: true,
                        title: item.title,
                        icon: <st.icon size={18} weight="duotone" style={{ color: st.hue }} />,
                        open: undefined,
                      };
                    }),
                  ]
                    .sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at)
                    .map((x) => (
                      <li key={x.key}>
                        <button type="button" onClick={x.open} disabled={!x.open} className="flex w-full items-center gap-3 text-left disabled:cursor-default">
                          {x.icon}
                          <span className="min-w-0 flex-1 truncate text-[14px]">{x.title}</span>
                          <span className={cn("shrink-0 text-[12px] font-medium tabular-nums", x.live ? "text-danger" : "text-muted-foreground")}>{upNextWhen(x.at, now.getTime(), x)}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </Card>

            <Card to="/lists" title="Tasks" icon={ListChecks} hue={hueOf("lists")} className="md:col-span-3">
              {!tasks.length ? (
                <Muted>{doneToday.length ? `All clear. ${doneToday.length} done today.` : "Nothing due today."}</Muted>
              ) : (
                <ul className="grid gap-1">
                  <AnimatePresence initial={false}>
                    {tasks.slice(0, 6).map((t) => (
                      <motion.li key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -10 }} className="flex items-center gap-3 py-1.5">
                        <CheckCircle checked={false} hue={hueOf("lists")} label={`Complete ${t.title}`} onChange={() => toggleTask.mutate({ id: t.id, done: true })} />
                        <span className="min-w-0 flex-1 truncate text-[14px]">{t.title}</span>
                        {t.dueDate! < today ? (
                          <Chip tone="danger">{relativeDay(t.dueDate!, today)}</Chip>
                        ) : t.dueTime ? (
                          <span className="text-[12px] tabular-nums text-muted-foreground">{formatMinutes(timeToMinutes(t.dueTime))}</span>
                        ) : null}
                      </motion.li>
                    ))}
                  </AnimatePresence>
                  {tasks.length > 6 ? <li className="pt-1 text-[13px] text-muted-foreground">and {tasks.length - 6} more</li> : null}
                </ul>
              )}
              <QuickTask />
            </Card>

            <Card to="/debts" title="Debts" icon={HandCoins} hue={hueOf("debts")} className="md:col-span-3">
              {!debtTotals || (!debtTotals.owedToMe && !debtTotals.iOwe) ? (
                <Muted>All square with everyone.</Muted>
              ) : (
                <>
                  <div className="flex gap-6">
                    <div>
                      <p className="text-[12px] text-muted-foreground">Owed to you</p>
                      <p className="text-[18px] font-semibold tabular-nums text-[#3fa66b]">{formatPaise(debtTotals.owedToMe)}</p>
                    </div>
                    <div>
                      <p className="text-[12px] text-muted-foreground">You owe</p>
                      <p className="text-[18px] font-semibold tabular-nums text-[#e05a5a]">{formatPaise(debtTotals.iOwe)}</p>
                    </div>
                  </div>
                  <ul className="mt-3 grid gap-1.5">
                    {topDebts.map(({ p, b }) => (
                      <li key={p.id} className="flex items-center justify-between text-[14px]">
                        <span className="truncate">{p.name}</span>
                        <span className="font-medium tabular-nums" style={{ color: b > 0 ? "#3fa66b" : "#e05a5a" }}>
                          {formatPaise(Math.abs(b))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Card>

            {goals.length ? (
              <Card to="/goals" title="Goals" icon={Flag} hue={hueOf("goals")} className="md:col-span-6">
                <GoalsGlance goals={goals} />
              </Card>
            ) : null}

            <Card to="/activity" title="Activity" icon={GridFour} hue={hueOf("activity")} className="md:col-span-3">
              <ActivityGlance hue={hueOf("activity")} />
            </Card>

            <Card to="/lists" title="Reading" icon={BookOpen} hue={hueOf("lists")} className="md:col-span-3">
              <ReadingGlance hue={hueOf("lists")} />
            </Card>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
