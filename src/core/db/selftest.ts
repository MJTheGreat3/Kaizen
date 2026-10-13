import { and, eq } from "drizzle-orm";

import { db, schema } from "./client";

export interface SelfTestStep {
  name: string;
  ok: boolean;
  detail?: string;
}

const KEY = "__selftest";

/**
 * Writes, reads, soft-deletes and removes a throwaway settings row, checking
 * that each change lands in the sync change log.
 */
export async function runSelfTest(): Promise<SelfTestStep[]> {
  const steps: SelfTestStep[] = [];
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail: detail || undefined });
      return true;
    } catch (e) {
      steps.push({ name, ok: false, detail: String(e) });
      return false;
    }
  };

  const value = JSON.stringify({ at: Date.now() });
  await db.delete(schema.settings).where(eq(schema.settings.id, KEY));

  // Each step runs only if the previous one passed.
  const checks: [string, () => Promise<string | void>][] = [
    [
      "Write a record",
      async () => {
        await db.insert(schema.settings).values({ id: KEY, value });
      },
    ],
    [
      "Read it back",
      async () => {
        const row = await db.select().from(schema.settings).where(eq(schema.settings.id, KEY)).get();
        if (row?.value !== value) throw new Error("value mismatch");
        return `device ${row.deviceId.slice(0, 8)}…`;
      },
    ],
    [
      "Soft-delete it",
      async () => {
        await db.update(schema.settings).set({ deletedAt: Date.now() }).where(eq(schema.settings.id, KEY));
        const row = await db.select().from(schema.settings).where(eq(schema.settings.id, KEY)).get();
        if (!row?.deletedAt) throw new Error("deleted_at not set");
      },
    ],
    [
      "Changes recorded for sync",
      async () => {
        const cells = await db
          .select({ col: schema.syncClock.col })
          .from(schema.syncClock)
          .where(and(eq(schema.syncClock.tableName, "settings"), eq(schema.syncClock.rowId, KEY)));
        const cols = cells.map((c) => c.col);
        if (!cols.includes("value") || !cols.includes("deleted_at")) throw new Error(`got [${cols.join(", ")}]`);
        return `${cols.length} cells`;
      },
    ],
  ];
  for (const [name, fn] of checks) {
    if (!(await step(name, fn))) break;
  }

  await step("Clean up", async () => {
    await db.delete(schema.settings).where(eq(schema.settings.id, KEY));
    await db.delete(schema.syncClock).where(eq(schema.syncClock.rowId, KEY));
  });

  return steps;
}
