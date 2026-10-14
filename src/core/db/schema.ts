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

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

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
  /** Where a laptop can be reached for direct sync. */
  addresses: json<string[]>("addresses").notNull().default([]),
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

// ---------------------------------------------------------------------------
// Phase 3 (migration v6)
// ---------------------------------------------------------------------------

export type FocusStatus = "running" | "paused" | "completed" | "withered" | "given_up";

export const focusSessions = sqliteTable("focus_sessions", {
  id: id(),
  /** Local day the session started. */
  date: text("date").notNull(),
  startedAt: integer("started_at").notNull(),
  plannedMinutes: integer("planned_minutes").notNull(),
  status: text("status", { enum: ["running", "paused", "completed", "withered", "given_up"] })
    .notNull()
    .default("running"),
  pausedAt: integer("paused_at"),
  pausedMs: integer("paused_ms").notNull().default(0),
  endedAt: integer("ended_at"),
  focusedMinutes: real("focused_minutes").notNull().default(0),
  tag: text("tag"),
  taskId: text("task_id"),
  species: text("species").notNull().default("oak"),
  strict: integer("strict", { mode: "boolean" }).notNull().default(false),
  note: text("note"),
  ...base,
});

/** Unlocked tree species; `id` is the species key. */
export const focusUnlocks = sqliteTable("focus_unlocks", {
  id: text("id").primaryKey(),
  ...base,
});

export type FocusSession = typeof focusSessions.$inferSelect;
export type FocusUnlock = typeof focusUnlocks.$inferSelect;

export type ActivityType = typeof activityTypes.$inferSelect;
export type ActivityEvent = typeof activityEvents.$inferSelect;

// ---------------------------------------------------------------------------
// Phase 3 (migration v7): goals and the search index
// ---------------------------------------------------------------------------

export type GoalKind = "manual" | "activity" | "habits" | "tasks";
export type GoalStatus = "active" | "done" | "archived";

export const goals = sqliteTable("goals", {
  id: id(),
  title: text("title").notNull(),
  notes: text("notes"),
  kind: text("kind", { enum: ["manual", "activity", "habits", "tasks"] }).notNull(),
  unit: text("unit"),
  /** Manual goals: where the metric started (a lower target means "go down"). */
  startValue: real("start_value").notNull().default(0),
  targetValue: real("target_value").notNull().default(1),
  startDate: text("start_date").notNull(),
  targetDate: text("target_date"),
  /** Activity goals: the type to total, optionally only events with this tag. */
  activityType: text("activity_type"),
  activityTag: text("activity_tag"),
  color: text("color").notNull(),
  status: text("status", { enum: ["active", "done", "archived"] })
    .notNull()
    .default("active"),
  completedAt: integer("completed_at"),
  sortOrder: real("sort_order").notNull().default(0),
  /** Manual goals filled automatically, e.g. `rating:codeforces` (migration v8). */
  metric: text("metric"),
  ...base,
});

export const goalLinks = sqliteTable("goal_links", {
  id: id(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id),
  kind: text("kind", { enum: ["habit", "task"] }).notNull(),
  refId: text("ref_id").notNull(),
  ...base,
});

export const goalEntries = sqliteTable("goal_entries", {
  id: id(),
  goalId: text("goal_id")
    .notNull()
    .references(() => goals.id),
  date: text("date").notNull(),
  value: real("value").notNull(),
  note: text("note"),
  ...base,
});

/** FTS5 table kept filled by triggers; read-only from the frontend. */
export const searchIndex = sqliteTable("search_index", {
  /** Source table and row. */
  src: text("src").notNull(),
  refId: text("ref_id").notNull(),
  /** Where the row lives: todo, watch, read, ideas, habits, dates, subjects, people, debts, goals. */
  module: text("module").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  tags: text("tags").notNull(),
  date: text("date"),
  amount: real("amount"),
  status: text("status"),
});

export type Goal = typeof goals.$inferSelect;
export type GoalLink = typeof goalLinks.$inferSelect;
export type GoalEntry = typeof goalEntries.$inferSelect;
export type SearchRow = typeof searchIndex.$inferSelect;

// ---------------------------------------------------------------------------
// Phase 4 (migration v8): competitive programming
// ---------------------------------------------------------------------------

export type CpPlatform = "codeforces" | "leetcode" | "atcoder" | "codechef";

/** One row per platform; `id` is the platform. */
export const cpAccounts = sqliteTable("cp_accounts", {
  id: text("id").$type<CpPlatform>().primaryKey(),
  handle: text("handle").notNull(),
  rating: real("rating"),
  maxRating: real("max_rating"),
  rankTitle: text("rank_title"),
  solved: integer("solved").notNull().default(0),
  contests: integer("contests").notNull().default(0),
  meta: json<Record<string, unknown>>("meta").notNull().default({}),
  /** Time of the newest submission already counted (ms). */
  cursor: integer("cursor").notNull().default(0),
  syncedAt: integer("synced_at"),
  error: text("error"),
  ...base,
});

export const cpProblems = sqliteTable("cp_problems", {
  /** `cf:1520A`, `lc:two-sum`, `ac:abc300_a`, `cc:CODE`, or `x:<uuid>` for logged ones. */
  id: id(),
  /** A platform id, or "other" for problems logged by hand. */
  platform: text("platform").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  url: text("url"),
  /** Numeric difficulty (Codeforces rating, AtCoder difficulty). */
  rating: real("rating"),
  /** Shown difficulty: "1500", "Medium"... */
  difficulty: text("difficulty"),
  tags: json<string[]>("tags").notNull().default([]),
  contestId: text("contest_id"),
  attempts: integer("attempts").notNull().default(0),
  firstAt: integer("first_at"),
  lastAt: integer("last_at"),
  solvedAt: integer("solved_at"),
  notes: text("notes"),
  minutes: integer("minutes"),
  solutionUrl: text("solution_url"),
  ...base,
});

/** Spaced repetition; `id` is the problem id. */
export const cpRevisit = sqliteTable("cp_revisit", {
  id: text("id").primaryKey(),
  problemId: text("problem_id").notNull(),
  stage: integer("stage").notNull().default(0),
  dueDate: text("due_date").notNull(),
  reviewedAt: integer("reviewed_at"),
  status: text("status", { enum: ["active", "done"] })
    .notNull()
    .default("active"),
  ...base,
});

/** Device-local cache of rating history. */
export const cpRatings = sqliteTable("cp_ratings", {
  id: text("id").primaryKey(),
  platform: text("platform").$type<CpPlatform>().notNull(),
  contest: text("contest").notNull(),
  at: integer("at").notNull(),
  rating: real("rating").notNull(),
  rank: integer("rank"),
});

/** Device-local cache of upcoming contests. */
export const cpContests = sqliteTable("cp_contests", {
  id: text("id").primaryKey(),
  platform: text("platform").$type<CpPlatform>().notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  startAt: integer("start_at").notNull(),
  durationMin: integer("duration_min").notNull(),
});

export interface GhMeta {
  name?: string | null;
  avatarUrl?: string | null;
  followers?: number;
  publicRepos?: number;
  /** Lower-cased handle whose past years have been read. */
  backfilledFor?: string;
}

/** The GitHub account (one row, id "github"). */
export const ghAccount = sqliteTable("gh_account", {
  id: text("id").$type<"github">().primaryKey(),
  handle: text("handle").notNull(),
  /** Contributions in the last 365 days. */
  contributions: integer("contributions").notNull().default(0),
  meta: json<GhMeta>("meta").notNull().default({}),
  syncedAt: integer("synced_at"),
  error: text("error"),
  ...base,
});

/** Device-local cache of the repositories pushed to most recently. */
export const ghRepos = sqliteTable("gh_repos", {
  /** "owner/name". */
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  description: text("description"),
  language: text("language"),
  stars: integer("stars").notNull().default(0),
  fork: integer("fork", { mode: "boolean" }).notNull().default(false),
  pushedAt: integer("pushed_at").notNull(),
  headSha: text("head_sha"),
  commitMessage: text("commit_message"),
  commitUrl: text("commit_url"),
  sort: integer("sort").notNull(),
});

/** Device-local cache of issues the user opened, is assigned or took part in. */
export const ghIssues = sqliteTable("gh_issues", {
  id: text("id").primaryKey(),
  repo: text("repo").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  state: text("state").$type<"open" | "closed">().notNull(),
  author: text("author").notNull(),
  role: text("role").$type<"author" | "assignee" | "involved">().notNull(),
  labels: json<string[]>("labels").notNull().default([]),
  comments: integer("comments").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  closedAt: integer("closed_at"),
});

export type GhAccount = typeof ghAccount.$inferSelect;
export type GhRepo = typeof ghRepos.$inferSelect;
export type GhIssue = typeof ghIssues.$inferSelect;

export type CpAccount = typeof cpAccounts.$inferSelect;
export type CpProblem = typeof cpProblems.$inferSelect;
export type CpRevisit = typeof cpRevisit.$inferSelect;
export type CpRating = typeof cpRatings.$inferSelect;
export type CpContest = typeof cpContests.$inferSelect;

// ---------------------------------------------------------------------------
// Sports (Phase 5)
// ---------------------------------------------------------------------------

export type SportId = "nba" | "football" | "cricket";

/** A session I played (any sport); feeds the `sports` activity type. */
export const sportSessions = sqliteTable("sport_sessions", {
  id: id(),
  sport: text("sport").notNull(),
  date: text("date").notNull(),
  minutes: integer("minutes").notNull(),
  /** 1 easy, 2 moderate, 3 hard. */
  intensity: integer("intensity"),
  notes: text("notes"),
  ...base,
});

/** A followed team, or a favourite player (the showcase, five at most). */
export const sportFollows = sqliteTable("sport_follows", {
  /** `{sport}:{kind}:{source id}`. */
  id: text("id").primaryKey(),
  sport: text("sport").$type<SportId>().notNull(),
  kind: text("kind").$type<"team" | "player">().notNull(),
  ref: text("ref").notNull(),
  name: text("name").notNull(),
  subtitle: text("subtitle"),
  /** ESPN league slug, or the Cricbuzz page slug for cricket teams. */
  league: text("league"),
  image: text("image"),
  sort: integer("sort").notNull().default(0),
  error: text("error"),
  ...base,
});

/** Device-local cache of followed teams' games. */
export const sportGames = sqliteTable("sport_games", {
  id: text("id").primaryKey(),
  followId: text("follow_id").notNull(),
  sport: text("sport").$type<SportId>().notNull(),
  startAt: integer("start_at").notNull(),
  league: text("league"),
  title: text("title"),
  home: text("home").notNull(),
  homeShort: text("home_short").notNull(),
  homeLogo: text("home_logo"),
  homeScore: text("home_score"),
  away: text("away").notNull(),
  awayShort: text("away_short").notNull(),
  awayLogo: text("away_logo"),
  awayScore: text("away_score"),
  state: text("state").$type<"pre" | "in" | "post">().notNull(),
  status: text("status").notNull(),
  url: text("url"),
});

export interface StatTable {
  title: string;
  columns: string[];
  rows: { label: string; values: string[] }[];
}

export interface PlayerStats {
  name: string;
  team: string | null;
  position: string | null;
  image: string | null;
  seasonLabel: string;
  highlights: { label: string; value: string }[];
  season: StatTable[];
  career: StatTable[];
}

/** Device-local cache of favourite players' stats. */
export const sportStats = sqliteTable("sport_stats", {
  id: text("id").primaryKey(),
  data: json<PlayerStats>("data").notNull(),
  fetchedAt: integer("fetched_at").notNull(),
});

export type SportSession = typeof sportSessions.$inferSelect;
export type SportFollow = typeof sportFollows.$inferSelect;
export type SportGame = typeof sportGames.$inferSelect;
export type SportStat = typeof sportStats.$inferSelect;

// ---------------------------------------------------------------------------
// Phase 5, gym (migration v11). Weights in kg, distances in km, times in seconds.
// ---------------------------------------------------------------------------

export type Muscle =
  | "chest"
  | "back"
  | "shoulders"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "quads"
  | "hamstrings"
  | "glutes"
  | "calves"
  | "full_body"
  | "cardio";

/** What an exercise's sets record. */
export type Measure = "weight" | "reps" | "time" | "cardio";

/** The library: built-in exercises (`ex:{slug}`) and my own. */
export const exercises = sqliteTable("exercises", {
  id: id(),
  name: text("name").notNull(),
  muscle: text("muscle").$type<Muscle>().notNull(),
  equipment: text("equipment").notNull().default("other"),
  measure: text("measure").$type<Measure>().notNull().default("weight"),
  notes: text("notes"),
  isBuiltin: integer("is_builtin", { mode: "boolean" }).notNull().default(false),
  ...base,
});

export interface TemplateItem {
  exerciseId: string;
  sets: number;
  /** Target reps, or seconds for timed exercises. */
  reps: number | null;
}

/** A routine to start workouts from (Push, Pull, Legs...). */
export const workoutTemplates = sqliteTable("workout_templates", {
  id: id(),
  name: text("name").notNull(),
  notes: text("notes"),
  exercises: json<TemplateItem[]>("exercises").notNull().default([]),
  sort: integer("sort").notNull().default(0),
  ...base,
});

/** A workout; in progress while `endedAt` is null. */
export const workouts = sqliteTable("workouts", {
  id: id(),
  name: text("name").notNull(),
  templateId: text("template_id"),
  date: text("date").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  notes: text("notes"),
  /** Total kg lifted over working sets, set on finish. */
  volume: real("volume").notNull().default(0),
  ...base,
});

export const workoutSets = sqliteTable("workout_sets", {
  id: id(),
  workoutId: text("workout_id").notNull(),
  exerciseId: text("exercise_id").notNull(),
  /** The exercise's place in the workout. */
  position: integer("position").notNull(),
  setIndex: integer("set_index").notNull(),
  warmup: integer("warmup", { mode: "boolean" }).notNull().default(false),
  weight: real("weight"),
  reps: integer("reps"),
  seconds: integer("seconds"),
  distance: real("distance"),
  rpe: real("rpe"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  ...base,
});

/** One row per day (`bm:{date}`); measurements in cm. */
export const bodyMetrics = sqliteTable("body_metrics", {
  id: text("id").primaryKey(),
  date: text("date").notNull(),
  weight: real("weight"),
  bodyFat: real("body_fat"),
  waist: real("waist"),
  chest: real("chest"),
  arms: real("arms"),
  thighs: real("thighs"),
  hips: real("hips"),
  neck: real("neck"),
  notes: text("notes"),
  ...base,
});

export type Exercise = typeof exercises.$inferSelect;
export type WorkoutTemplate = typeof workoutTemplates.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;
export type BodyMetric = typeof bodyMetrics.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
