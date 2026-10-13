/**
 * Writes to the shared `activity_events` table that the heatmap and streaks
 * (Phase 3) read. Each event points back at the row that caused it, so
 * undoing an action removes its event.
 */
import { and, eq } from "drizzle-orm";

import { db, schema } from "@/core/db/client";
import type { DateKey } from "@/lib/dates";

export type ActivityType = "cp" | "gym" | "sports" | "focus" | "habits" | "reading" | "tasks" | "classes";

export async function recordActivity(
  typeId: ActivityType,
  date: DateKey,
  sourceTable: string,
  sourceId: string,
  quantity = 1,
) {
  await clearActivity(sourceTable, sourceId);
  await db.insert(schema.activityEvents).values({
    typeId,
    date,
    occurredAt: Date.now(),
    quantity,
    sourceTable,
    sourceId,
  });
}

export async function clearActivity(sourceTable: string, sourceId: string) {
  await db
    .delete(schema.activityEvents)
    .where(and(eq(schema.activityEvents.sourceTable, sourceTable), eq(schema.activityEvents.sourceId, sourceId)));
}
