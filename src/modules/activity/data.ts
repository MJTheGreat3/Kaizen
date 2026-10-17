import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "@/core/db/client";
import type { ActivityEvent, ActivityType } from "@/core/db/schema";
import type { DateKey } from "@/lib/dates";
import { ruleFor, type ActiveRule } from "./logic";

const e = schema.activityEvents;
const t = schema.activityTypes;

export interface TypeWithRule extends ActivityType {
  rule: ActiveRule;
}

export interface ActivityData {
  types: TypeWithRule[];
  events: ActivityEvent[];
  /** Tags of each event's source (tasks, and the book of a reading session), by event id. */
  tags: Map<string, string[]>;
  allTags: string[];
}

export async function loadActivity(): Promise<ActivityData> {
  const [types, events, tasks, sessions] = await Promise.all([
    db.select().from(t).where(isNull(t.deletedAt)).orderBy(asc(t.sortOrder)),
    db.select().from(e).where(isNull(e.deletedAt)),
    db.select({ id: schema.tasks.id, tags: schema.tasks.tags }).from(schema.tasks),
    db.select({ id: schema.readingSessions.id, taskId: schema.readingSessions.taskId }).from(schema.readingSessions),
  ]);
  const taskTags = new Map(tasks.map((x) => [x.id, x.tags ?? []]));
  const bookOf = new Map(sessions.map((x) => [x.id, x.taskId]));
  const tags = new Map<string, string[]>();
  for (const ev of events) {
    const source = ev.sourceTable === "reading_sessions" ? bookOf.get(ev.sourceId ?? "") : ev.sourceTable === "tasks" ? ev.sourceId : undefined;
    const found = source ? taskTags.get(source) : undefined;
    if (found?.length) tags.set(ev.id, found);
  }
  const allTags = [...new Set([...tags.values()].flat())].sort();
  return { types: types.map((x) => ({ ...x, rule: ruleFor(x.id, x.activeDayRule) })), events, tags, allTags };
}

export function useActivity() {
  // Every module writes activity, so always refresh when the page opens.
  return useQuery({ queryKey: ["activity"], queryFn: loadActivity, staleTime: 0 });
}

export function useSaveRule() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ typeId, rule }: { typeId: string; rule: ActiveRule }) => {
      await db.update(t).set({ activeDayRule: JSON.stringify(rule) }).where(eq(t.id, typeId));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["activity"] }),
  });
}

export interface DayLogItem {
  id: string;
  typeId: string;
  label: string;
  quantity: number;
}

/** What happened on one day, with titles from each event's source. */
export async function loadDayLog(date: DateKey): Promise<DayLogItem[]> {
  const events = await db.select().from(e).where(and(isNull(e.deletedAt), eq(e.date, date)));
  const ids = (table: string) => events.filter((x) => x.sourceTable === table).map((x) => x.sourceId ?? "");
  const habitIds = ids("habit_logs").map((k) => k.split(":")[0]);
  const [tasks, habits, marks, sessions, games, lifts] = await Promise.all([
    ids("tasks").length ? db.select().from(schema.tasks).where(inArray(schema.tasks.id, ids("tasks"))) : [],
    habitIds.length ? db.select().from(schema.habits).where(inArray(schema.habits.id, habitIds)) : [],
    ids("attendance").length
      ? db
          .select({ key: schema.attendance.classKey, kind: schema.attendance.classKind, subject: schema.subjects.name })
          .from(schema.attendance)
          .innerJoin(schema.subjects, eq(schema.subjects.id, schema.attendance.subjectId))
          .where(inArray(schema.attendance.classKey, ids("attendance")))
      : [],
    ids("reading_sessions").length
      ? db
          .select({ id: schema.readingSessions.id, book: schema.tasks.title })
          .from(schema.readingSessions)
          .innerJoin(schema.tasks, eq(schema.tasks.id, schema.readingSessions.taskId))
          .where(inArray(schema.readingSessions.id, ids("reading_sessions")))
      : [],
    ids("sport_sessions").length
      ? db.select().from(schema.sportSessions).where(inArray(schema.sportSessions.id, ids("sport_sessions")))
      : [],
    ids("workouts").length ? db.select().from(schema.workouts).where(inArray(schema.workouts.id, ids("workouts"))) : [],
  ]);
  const title = (ev: ActivityEvent): string => {
    const id = ev.sourceId ?? "";
    switch (ev.sourceTable) {
      case "tasks":
        return tasks.find((x) => x.id === id)?.title ?? "Task";
      case "habit_logs":
        return habits.find((x) => x.id === id.split(":")[0])?.name ?? "Habit";
      case "attendance": {
        const m = marks.find((x) => x.key === id);
        return m ? `${m.subject}${m.kind === "lecture" ? "" : ` ${m.kind}`}` : "Class";
      }
      case "reading_sessions":
        return sessions.find((x) => x.id === id)?.book ?? "Reading";
      case "github":
        return "GitHub";
      case "sport_sessions":
        return games.find((x) => x.id === id)?.sport ?? "Sports";
      case "workouts":
        return lifts.find((x) => x.id === id)?.name ?? "Workout";
      default:
        return ev.typeId;
    }
  };
  return events
    .sort((a, b) => a.occurredAt - b.occurredAt)
    .map((ev) => ({ id: ev.id, typeId: ev.typeId, label: title(ev), quantity: ev.quantity }));
}

export function useDayLog(date: DateKey | null) {
  return useQuery({ queryKey: ["activity-day", date], queryFn: () => loadDayLog(date!), enabled: !!date });
}
