/**
 * Writes to the shared `activity_events` table that the heatmap and streaks
 * (Phase 3) read. Each event points back at the row that caused it, so
 * undoing an action removes its event. Events are soft-deleted and their id
 * comes from the source, so the same action on two devices syncs as one.
 */
import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/core/db/client";
import type { DateKey } from "@/lib/dates";

export type ActivityType = "cp" | "gym" | "sports" | "habits" | "reading" | "tasks" | "classes";

export async function recordActivity(
  typeId: ActivityType,
  date: DateKey,
  sourceTable: string,
  sourceId: string,
  quantity = 1,
) {
  const e = schema.activityEvents;
  const id = `ae:${sourceTable}:${sourceId}`;
  // Older events for the same source may have random ids.
  await db
    .update(e)
    .set({ deletedAt: Date.now() })
    .where(and(eq(e.sourceTable, sourceTable), eq(e.sourceId, sourceId), isNull(e.deletedAt)));
  const values = { typeId, date, occurredAt: Date.now(), quantity, deletedAt: null };
  await db
    .insert(e)
    .values({ id, sourceTable, sourceId, ...values })
    .onConflictDoUpdate({ target: e.id, set: { ...values, updatedAt: Date.now() } });
}

export async function clearActivity(sourceTable: string, sourceId: string) {
  const e = schema.activityEvents;
  await db
    .update(e)
    .set({ deletedAt: Date.now() })
    .where(and(eq(e.sourceTable, sourceTable), eq(e.sourceId, sourceId), isNull(e.deletedAt)));
}
