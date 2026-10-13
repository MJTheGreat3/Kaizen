/**
 * Typed mirror of the SQL schema in `src-tauri/src/db/migrations.rs`.
 * The Rust migrations are the source of truth; keep this file in step.
 */
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { uuidv7 } from "uuidv7";

import { currentDeviceId } from "@/core/security/session";

/** Columns every synced table carries. */
const base = {
  createdAt: integer("created_at")
    .notNull()
    .$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at")
    .notNull()
    .$defaultFn(() => Date.now())
    .$onUpdateFn(() => Date.now()),
  deletedAt: integer("deleted_at"),
  deviceId: text("device_id").notNull().$defaultFn(currentDeviceId),
};

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

/** Device-local key/value store, never synced. */
export const localMeta = sqliteTable("local_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** Last-writer-wins clock per synced cell, written by triggers. */
export const syncClock = sqliteTable("sync_clock", {
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  col: text("col").notNull(),
  ts: integer("ts").notNull(),
  deviceId: text("device_id").notNull(),
  seq: integer("seq").notNull(),
});

/** Device-local history of sync runs. */
export const syncLog = sqliteTable("sync_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  at: integer("at").notNull(),
  transport: text("transport").notNull(),
  sent: integer("sent").notNull(),
  received: integer("received").notNull(),
  error: text("error"),
});

/** Synced settings; `id` is the key and `value` is JSON. */
export const settings = sqliteTable("settings", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
  ...base,
});

export const devices = sqliteTable("devices", {
  id: id(),
  name: text("name").notNull(),
  platform: text("platform").notNull(),
  lastSeenAt: integer("last_seen_at"),
  ...base,
});

export const activityTypes = sqliteTable("activity_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  unit: text("unit"),
  activeDayRule: text("active_day_rule").notNull().default("{}"),
  sortOrder: integer("sort_order").notNull().default(0),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  ...base,
});

export const activityEvents = sqliteTable("activity_events", {
  id: id(),
  typeId: text("type_id")
    .notNull()
    .references(() => activityTypes.id),
  /** Local calendar date, `YYYY-MM-DD`. */
  date: text("date").notNull(),
  occurredAt: integer("occurred_at").notNull(),
  quantity: real("quantity").notNull().default(1),
  unit: text("unit"),
  sourceTable: text("source_table"),
  sourceId: text("source_id"),
  ...base,
});

export const reminders = sqliteTable("reminders", {
  id: id(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  title: text("title").notNull(),
  body: text("body"),
  fireAt: integer("fire_at").notNull(),
  recurrence: text("recurrence"),
  status: text("status", { enum: ["scheduled", "fired", "dismissed", "cancelled"] })
    .notNull()
    .default("scheduled"),
  ...base,
});

export const attachments = sqliteTable("attachments", {
  id: id(),
  ownerTable: text("owner_table").notNull(),
  ownerId: text("owner_id").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes").notNull(),
  relPath: text("rel_path").notNull(),
  ...base,
});

// ---------------------------------------------------------------------------
// Phase 1 (migration v2)
// ---------------------------------------------------------------------------

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export type TaskList = "todo" | "watch" | "read";
export type TaskStatus = "open" | "in_progress" | "done";
export type Recurrence = "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export interface TaskMeta {
  /** Books: pages read and total pages. */
  pagesRead?: number;
  pagesTotal?: number;
  author?: string;
  /** Watch list: movie, show, anime, documentary... */
  medium?: string;
  /** 1 to 5, set when finished. */
  rating?: number;
}

export const tasks = sqliteTable("tasks", {
  id: id(),
  list: text("list", { enum: ["todo", "watch", "read"] }).notNull(),
  title: text("title").notNull(),
  notes: text("notes"),
  status: text("status", { enum: ["open", "in_progress", "done"] })
    .notNull()
    .default("open"),
  dueDate: text("due_date"),
  dueTime: text("due_time"),
  remind: integer("remind", { mode: "boolean" }).notNull().default(false),
  recurrence: text("recurrence").$type<Recurrence | null>(),
  priority: integer("priority").notNull().default(0),
  tags: json<string[]>("tags").notNull().default([]),
  meta: json<TaskMeta>("meta").notNull().default({}),
  completedAt: integer("completed_at"),
  sortOrder: real("sort_order").notNull().default(0),
  ...base,
});

export type HabitSchedule =
  | { type: "daily" }
  | { type: "weekdays"; days: number[] }
  | { type: "weekly"; times: number };

export const habits = sqliteTable("habits", {
  id: id(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  kind: text("kind", { enum: ["check", "count"] })
    .notNull()
    .default("check"),
  target: real("target").notNull().default(1),
  unit: text("unit"),
  schedule: json<HabitSchedule>("schedule").notNull().default({ type: "daily" }),
  reminderTime: text("reminder_time"),
  startDate: text("start_date").notNull(),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  sortOrder: real("sort_order").notNull().default(0),
  ...base,
});

export const habitLogs = sqliteTable("habit_logs", {
  id: id(),
  habitId: text("habit_id")
    .notNull()
    .references(() => habits.id),
  date: text("date").notNull(),
  value: real("value").notNull().default(1),
  ...base,
});

export const ideas = sqliteTable("ideas", {
  id: id(),
  body: text("body").notNull(),
  tags: json<string[]>("tags").notNull().default([]),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  color: text("color"),
  ...base,
});

export type DateKind = "birthday" | "anniversary" | "exam" | "deadline" | "renewal" | "other";

export const importantDates = sqliteTable("important_dates", {
  id: id(),
  title: text("title").notNull(),
  kind: text("kind").$type<DateKind>().notNull().default("other"),
  date: text("date").notNull(),
  recurrence: text("recurrence", { enum: ["none", "monthly", "yearly"] })
    .notNull()
    .default("none"),
  remindOffsets: json<number[]>("remind_offsets").notNull().default([0, 1]),
  notes: text("notes"),
  ...base,
});

export const semesters = sqliteTable("semesters", {
  id: id(),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  target: real("target").notNull().default(80),
  separateLabs: integer("separate_labs", { mode: "boolean" }).notNull().default(false),
  separateTutorials: integer("separate_tutorials", { mode: "boolean" }).notNull().default(false),
  unmarkedDefault: text("unmarked_default", { enum: ["present", "unmarked"] })
    .notNull()
    .default("unmarked"),
  reminderMinutes: integer("reminder_minutes").notNull().default(10),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  ...base,
});

export const subjects = sqliteTable("subjects", {
  id: id(),
  semesterId: text("semester_id")
    .notNull()
    .references(() => semesters.id),
  name: text("name").notNull(),
  code: text("code"),
  professor: text("professor"),
  color: text("color").notNull(),
  target: real("target"),
  ...base,
});

export type ClassKind = "lecture" | "lab" | "tutorial";

export const timetableSlots = sqliteTable("timetable_slots", {
  id: id(),
  semesterId: text("semester_id")
    .notNull()
    .references(() => semesters.id),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  /** 1 = Monday ... 7 = Sunday. */
  weekday: integer("weekday").notNull(),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  kind: text("kind", { enum: ["lecture", "lab", "tutorial"] })
    .notNull()
    .default("lecture"),
  room: text("room"),
  weekParity: text("week_parity", { enum: ["all", "odd", "even"] })
    .notNull()
    .default("all"),
  ...base,
});

export const timetableExceptions = sqliteTable("timetable_exceptions", {
  id: id(),
  semesterId: text("semester_id")
    .notNull()
    .references(() => semesters.id),
  kind: text("kind", { enum: ["extra", "cancel", "holiday", "vacation"] }).notNull(),
  date: text("date").notNull(),
  endDate: text("end_date"),
  slotId: text("slot_id"),
  subjectId: text("subject_id"),
  classKind: text("class_kind").$type<ClassKind | null>(),
  startMin: integer("start_min"),
  endMin: integer("end_min"),
  room: text("room"),
  title: text("title"),
  ...base,
});

export type AttendanceStatus = "present" | "absent" | "excused";

export const attendance = sqliteTable("attendance", {
  id: id(),
  semesterId: text("semester_id")
    .notNull()
    .references(() => semesters.id),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  classKey: text("class_key").notNull(),
  date: text("date").notNull(),
  classKind: text("class_kind").$type<ClassKind>().notNull(),
  status: text("status", { enum: ["present", "absent", "excused"] }).notNull(),
  ...base,
});

export const people = sqliteTable("people", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone"),
  notes: text("notes"),
  ...base,
});

export const debts = sqliteTable("debts", {
  id: id(),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  direction: text("direction", { enum: ["owed_to_me", "i_owe"] }).notNull(),
  amountPaise: integer("amount_paise").notNull(),
  occurredOn: text("occurred_on").notNull(),
  reason: text("reason"),
  dueOn: text("due_on"),
  notes: text("notes"),
  ...base,
});

export const debtPayments = sqliteTable("debt_payments", {
  id: id(),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  direction: text("direction", { enum: ["to_me", "from_me"] }).notNull(),
  amountPaise: integer("amount_paise").notNull(),
  paidOn: text("paid_on").notNull(),
  note: text("note"),
  ...base,
});

export type Task = typeof tasks.$inferSelect;
export type Habit = typeof habits.$inferSelect;
export type HabitLog = typeof habitLogs.$inferSelect;
export type Idea = typeof ideas.$inferSelect;
export type ImportantDate = typeof importantDates.$inferSelect;
export type Semester = typeof semesters.$inferSelect;
export type Subject = typeof subjects.$inferSelect;
export type TimetableSlot = typeof timetableSlots.$inferSelect;
export type TimetableException = typeof timetableExceptions.$inferSelect;
export type AttendanceMark = typeof attendance.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Debt = typeof debts.$inferSelect;
export type DebtPayment = typeof debtPayments.$inferSelect;
