/**
 * Builds the list of upcoming notifications from current data. Pure, so the
 * same plan drives Android's scheduled alarms and desktop timers.
 */
import type { Prefs } from "@/core/db/prefs";
import type { Habit, ImportantDate, Task } from "@/core/db/schema";
import { addDaysKey, atTime, timeToMinutes, todayKey, type DateKey } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { occurrencesBetween } from "@/modules/calendar/attendance";
import type { CalendarData } from "@/modules/calendar/data";
import { nextOccurrence } from "@/modules/calendar/data";
import type { DebtsData } from "@/modules/debts/data";
import { isDone, isScheduled, type DayValues } from "@/modules/habits/streaks";

export interface PlannedNotification {
  /** Stable key, hashed into the numeric id the OS needs. */
  key: string;
  at: Date;
  title: string;
  body: string;
}

export interface PlanInput {
  now: Date;
  prefs: Prefs;
  tasks: Task[];
  habits: { habits: Habit[]; values: Map<string, DayValues> };
  calendar: CalendarData;
  dates: ImportantDate[];
  debts: DebtsData;
  /** Streaks at risk today: current length and whether today already counts. */
  streaks?: { name: string; current: number; doneToday: boolean; unit: "days" | "weeks" }[];
  /** Upcoming programming contests (already filtered to the chosen sites). */
  contests?: { id: string; name: string; startAt: number; site: string }[];
  /** Upcoming games of followed teams: "India v West Indies". */
  matches?: { id: string; title: string; startAt: number; detail: string }[];
  /** Active goals with a finish date, and what is left. */
  goals?: { id: string; title: string; targetDate: DateKey; left: string }[];
}

/** 31-bit positive integer from a string (FNV-1a). */
export function notificationId(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) || 1;
}

const DAY_START = 9 * 60;

export function buildPlan(input: PlanInput, horizonDays = 3): PlannedNotification[] {
  const { now, prefs } = input;
  const today = todayKey(now);
  const last = addDaysKey(today, horizonDays);
  const out: PlannedNotification[] = [];
  const push = (n: PlannedNotification) => {
    if (n.at.getTime() > now.getTime() + 5_000 && n.at <= atTime(last, 24 * 60)) out.push(n);
  };

  if (prefs["notify.tasks"]) {
    for (const t of input.tasks) {
      if (!t.remind || !t.dueDate || t.status === "done" || t.deletedAt) continue;
      const minutes = t.dueTime ? timeToMinutes(t.dueTime) : DAY_START;
      push({ key: `task:${t.id}:${t.dueDate}`, at: atTime(t.dueDate, minutes), title: t.title, body: t.dueTime ? "Due now" : "Due today" });
    }
  }

  const { semester, subjects, slots, exceptions, marks } = input.calendar;
  if (semester && (prefs["notify.classes"] || prefs["notify.attendance"])) {
    const names = new Map(subjects.map((s) => [s.id, s.name]));
    const marked = new Set(marks.map((m) => m.classKey));
    for (const o of occurrencesBetween(semester, slots, exceptions, today, last)) {
      if (o.cancelled) continue;
      const name = names.get(o.subjectId) ?? "Class";
      const kind = o.kind === "lecture" ? "" : ` ${o.kind}`;
      if (prefs["notify.classes"] && semester.reminderMinutes > 0) {
        push({
          key: `class:${o.key}`,
          at: atTime(o.date, o.startMin - semester.reminderMinutes),
          title: `${name}${kind} in ${semester.reminderMinutes} min`,
          body: o.room ? `Room ${o.room}` : "Starting soon",
        });
      }
      if (prefs["notify.attendance"] && !marked.has(o.key)) {
        push({ key: `attend:${o.key}`, at: atTime(o.date, o.endMin), title: `Attended ${name}${kind}?`, body: "Tap to mark attendance" });
      }
    }
  }

  if (prefs["notify.habits"]) {
    for (const h of input.habits.habits) {
      if (!h.reminderTime) continue;
      const values = input.habits.values.get(h.id) ?? new Map();
      for (let d: DateKey = today; d <= last; d = addDaysKey(d, 1)) {
        const due = h.schedule.type === "weekly" || isScheduled(h, d);
        if (!due || isDone(h, values.get(d))) continue;
        push({ key: `habit:${h.id}:${d}`, at: atTime(d, timeToMinutes(h.reminderTime)), title: h.name, body: "Still to do today" });
      }
    }
  }

  if (prefs["notify.dates"]) {
    for (const item of input.dates) {
      const next = nextOccurrence(item, today);
      if (!next) continue;
      for (const offset of item.remindOffsets) {
        const day = addDaysKey(next, -offset);
        const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : `in ${offset} days`;
        push({ key: `date:${item.id}:${next}:${offset}`, at: atTime(day, DAY_START), title: `${item.title} ${when}`, body: "Important date" });
      }
    }
  }

  if (prefs["notify.debts"]) {
    const people = new Map(input.debts.people.map((p) => [p.id, p.name]));
    for (const d of input.debts.debts) {
      const balance = input.debts.balance.get(d.personId) ?? 0;
      if (!d.dueOn || balance === 0) continue;
      const name = people.get(d.personId) ?? "Someone";
      push({
        key: `debt:${d.id}`,
        at: atTime(d.dueOn, 10 * 60),
        title: d.direction === "owed_to_me" ? `${name} owes you ${formatPaise(Math.abs(balance))}` : `You owe ${name} ${formatPaise(Math.abs(balance))}`,
        body: d.reason ? `Due today: ${d.reason}` : "Due today",
      });
    }
  }

  if (prefs["notify.streaks"]) {
    for (const st of input.streaks ?? []) {
      if (st.unit !== "days" || st.doneToday || st.current < 3) continue;
      push({
        key: `streak:${st.name}:${today}`,
        at: atTime(today, 20 * 60 + 30),
        title: `Keep your ${st.current}-day ${st.name} streak`,
        body: "A little today keeps it going.",
      });
    }
  }

  if (prefs["notify.contests"]) {
    const lead = prefs["notify.contestsLead"];
    for (const c of input.contests ?? []) {
      push({
        key: `contest:${c.id}:${c.startAt}`,
        at: new Date(c.startAt - lead * 60_000),
        title: `${c.name} starts ${lead >= 60 ? `in ${lead / 60} h` : `in ${lead} min`}`,
        body: c.site,
      });
    }
  }

  if (prefs["notify.matches"]) {
    const lead = prefs["notify.matchesLead"];
    for (const g of input.matches ?? []) {
      push({
        key: `match:${g.id}:${g.startAt}`,
        at: new Date(g.startAt - lead * 60_000),
        title: `${g.title} starts ${lead >= 60 ? `in ${lead / 60} h` : `in ${lead} min`}`,
        body: g.detail,
      });
    }
  }

  if (prefs["notify.goals"]) {
    for (const g of input.goals ?? []) {
      for (const [offset, when] of [
        [7, "a week left"],
        [1, "due tomorrow"],
      ] as const) {
        push({ key: `goal:${g.id}:${g.targetDate}:${offset}`, at: atTime(addDaysKey(g.targetDate, -offset), DAY_START), title: `${g.title}: ${when}`, body: g.left });
      }
    }
  }

  const digest = prefs["notify.digest"];
  if (digest) {
    for (let d: DateKey = today; d <= last; d = addDaysKey(d, 1)) {
      const classes = semester ? occurrencesBetween(semester, slots, exceptions, d, d).filter((o) => !o.cancelled).length : 0;
      const tasks = input.tasks.filter((t) => t.list === "todo" && t.status !== "done" && t.dueDate !== null && t.dueDate <= d).length;
      const habits = input.habits.habits.filter((h) => h.schedule.type === "weekly" || isScheduled(h, d)).length;
      const parts = [
        classes ? `${classes} ${classes === 1 ? "class" : "classes"}` : null,
        tasks ? `${tasks} ${tasks === 1 ? "task" : "tasks"}` : null,
        habits ? `${habits} ${habits === 1 ? "habit" : "habits"}` : null,
      ].filter(Boolean);
      if (!parts.length) continue;
      push({ key: `digest:${d}`, at: atTime(d, timeToMinutes(digest)), title: "Your day", body: parts.join(", ") });
    }
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}
