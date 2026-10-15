/**
 * What the phone's home-screen widgets show that only the app works out:
 * every streak (activity types, any activity, habits) and the Up next list,
 * the same as on Today. Written to `widget-app.json` by `widget_refresh`.
 */
import { getPref } from "@/core/db/prefs";
import { todayKey } from "@/lib/dates";
import { loadActivity } from "@/modules/activity/data";
import { activeDays, streak, totalsByDay } from "@/modules/activity/logic";
import { upcomingDates, loadDates } from "@/modules/calendar/data";
import { DATE_STYLE } from "@/modules/calendar/labels";
import { totals as debtTotals } from "@/modules/debts/balances";
import { loadDebts } from "@/modules/debts/data";
import { formatPaise } from "@/lib/money";
import { loadHabits } from "@/modules/habits/data";
import { streaks as habitStreaks } from "@/modules/habits/streaks";
import { loadContests } from "@/modules/practice/data";
import { platformOf } from "@/modules/practice/logic";
import { modules } from "@/modules/registry";
import { loadMatches } from "@/modules/sports/data";

export interface StreakFeed {
  /** `type:<activity type>`, `all`, or `habit:<id>`. */
  id: string;
  name: string;
  color: string;
  current: number;
  best: number;
  unit: "days" | "weeks";
  /** Done today (or this week, for weekly streaks). */
  doneNow: boolean;
}

export interface UpNextFeed {
  title: string;
  /** ms */
  at: number;
  live: boolean;
  allDay: boolean;
  color: string;
}

export interface DebtFeed {
  owedToMe: string;
  iOwe: string;
  /** Positive: others owe you on balance. */
  net: number;
  netText: string;
  /** The biggest balances: "Rahul owes you ₹250", "You owe Priya ₹1,200". */
  people: { name: string; amount: string; toMe: boolean }[];
}

export interface WidgetFeed {
  streaks: StreakFeed[];
  upNext: UpNextFeed[];
  debts: DebtFeed;
  at: number;
}

const hue = (id: string) => modules.find((m) => m.id === id)?.hue ?? "#7a6ff0";

export async function buildWidgetFeed(now = Date.now()): Promise<WidgetFeed> {
  const today = todayKey(new Date(now));
  const [activity, habits, dates, contests, platforms, matches, debts] = await Promise.all([
    loadActivity(),
    loadHabits(400),
    loadDates(),
    loadContests(),
    getPref("practice.contestPlatforms"),
    loadMatches(now),
    loadDebts(),
  ]);

  const totals = totalsByDay(activity.events);
  const out: StreakFeed[] = [];
  const any = new Set<string>();
  for (const t of activity.types) {
    const active = activeDays(totals.get(t.id), t.rule);
    if (!active.size) continue;
    active.forEach((d) => any.add(d));
    const s = streak(active, t.rule, today);
    out.push({ id: `type:${t.id}`, name: t.name, color: t.color, current: s.current, best: s.longest, unit: s.unit, doneNow: s.doneNow });
  }
  const overall = streak(any, { period: "day", min: 1, perWeek: 1, restDays: [], freezesPerMonth: 0 }, today);
  out.unshift({ id: "all", name: "Any activity", color: hue("activity"), current: overall.current, best: overall.longest, unit: "days", doneNow: overall.doneNow });
  for (const h of habits.habits) {
    if (h.archived) continue;
    const values = habits.values.get(h.id) ?? new Map();
    const s = habitStreaks(h, values, today);
    const done = (values.get(today) ?? 0) >= (h.kind === "check" ? 1 : h.target);
    out.push({ id: `habit:${h.id}`, name: h.name, color: h.color, current: s.current, best: s.best, unit: s.unit, doneNow: done });
  }

  const upNext: UpNextFeed[] = [
    ...matches
      .filter((g) => g.startAt < now + 2 * 86_400_000)
      .slice(0, 3)
      .map((g) => ({ title: `${g.homeShort || g.home} v ${g.awayShort || g.away}`, at: g.startAt, live: g.state === "in", allDay: false, color: hue("sports") })),
    ...contests
      .filter((c) => platforms.includes(c.platform) && c.startAt < now + 7 * 86_400_000)
      .slice(0, 3)
      .map((c) => ({ title: c.name, at: c.startAt, live: c.startAt <= now, allDay: false, color: platformOf(c.platform)?.color ?? hue("practice") })),
    ...upcomingDates(dates, today, 14)
      .slice(0, 4)
      .map(({ item, date }) => ({ title: item.title, at: new Date(`${date}T00:00:00`).getTime(), live: false, allDay: true, color: (DATE_STYLE[item.kind] ?? DATE_STYLE.other).hue })),
  ].sort((a, b) => Number(b.live) - Number(a.live) || a.at - b.at);

  const sum = debtTotals(debts.balance);
  const names = new Map(debts.people.map((p) => [p.id, p.name]));
  const people = [...debts.balance]
    .filter(([, v]) => v !== 0)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3)
    .map(([id, v]) => ({ name: names.get(id) ?? "Someone", amount: formatPaise(Math.abs(v)), toMe: v > 0 }));
  const debtFeed: DebtFeed = {
    owedToMe: formatPaise(sum.owedToMe),
    iOwe: formatPaise(sum.iOwe),
    net: sum.net,
    netText: formatPaise(Math.abs(sum.net)),
    people,
  };

  return { streaks: out, upNext, debts: debtFeed, at: now };
}
