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

export const syncChanges = sqliteTable("sync_changes", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  tableName: text("table_name").notNull(),
  rowId: text("row_id").notNull(),
  op: text("op", { enum: ["insert", "update", "delete"] }).notNull(),
  changedAt: integer("changed_at").notNull(),
  deviceId: text("device_id"),
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
