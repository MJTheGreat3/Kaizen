/**
 * Device-specific preferences stored in `local_meta` (never synced), e.g.
 * where this device writes its backups.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";

import { db, schema } from "./client";

export interface Prefs {
  /** Minutes of inactivity before auto-lock; 0 disables. */
  "lock.timeoutMinutes": number;
  /** Backup folder; empty means the app's default folder. */
  "backup.dir": string;
  "backup.frequency": "off" | "daily" | "weekly";
  "backup.keep": number;
  "backup.lastAt": number;
  /** Notification categories on this device. */
  "notify.classes": boolean;
  "notify.attendance": boolean;
  "notify.habits": boolean;
  "notify.tasks": boolean;
  "notify.dates": boolean;
  "notify.debts": boolean;
  /** Morning summary time (`HH:MM`), or empty for none. */
  "notify.digest": string;
  /** Shared folder to sync through (desktop), or empty. */
  "sync.folder": string;
  /** Laptop address for direct sync (phone): IP or name, optional `:port`. */
  "sync.lanHost": string;
  /** Focus timer defaults on this device. */
  "focus.minutes": number;
  "focus.rest": number;
  "focus.species": string;
  /** Leaving (another app, or the window on desktop) withers the tree. */
  "focus.strict": boolean;
  /** Turn on Do Not Disturb during sessions (Android). */
  "focus.dnd": boolean;
  /** Seconds allowed away before the tree withers. */
  "focus.grace": number;
}

export const defaultPrefs: Prefs = {
  "lock.timeoutMinutes": 5,
  "backup.dir": "",
  "backup.frequency": "daily",
  "backup.keep": 10,
  "backup.lastAt": 0,
  "notify.classes": true,
  "notify.attendance": true,
  "notify.habits": true,
  "notify.tasks": true,
  "notify.dates": true,
  "notify.debts": true,
  "notify.digest": "07:30",
  "sync.folder": "",
  "sync.lanHost": "",
  "focus.minutes": 25,
  "focus.rest": 5,
  "focus.species": "oak",
  "focus.strict": true,
  "focus.dnd": true,
  "focus.grace": 10,
};

const PREFIX = "pref.";

export async function getPref<K extends keyof Prefs>(key: K): Promise<Prefs[K]> {
  const row = await db
    .select({ value: schema.localMeta.value })
    .from(schema.localMeta)
    .where(eq(schema.localMeta.key, PREFIX + key))
    .get();
  if (!row) return defaultPrefs[key];
  try {
    return JSON.parse(row.value) as Prefs[K];
  } catch {
    return defaultPrefs[key];
  }
}

export async function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): Promise<void> {
  const encoded = JSON.stringify(value);
  await db
    .insert(schema.localMeta)
    .values({ key: PREFIX + key, value: encoded })
    .onConflictDoUpdate({ target: schema.localMeta.key, set: { value: encoded } });
}

export function usePref<K extends keyof Prefs>(key: K) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["pref", key], queryFn: () => getPref(key) });
  const mutation = useMutation({
    mutationFn: (value: Prefs[K]) => setPref(key, value),
    onSuccess: (_, value) => client.setQueryData(["pref", key], value),
  });
  return [query.data ?? defaultPrefs[key], mutation.mutateAsync, query.isLoading] as const;
}

/** All preferences at once (defaults filled in). */
export async function getAllPrefs(): Promise<Prefs> {
  const rows = await db.select().from(schema.localMeta);
  const out = { ...defaultPrefs } as Record<string, unknown>;
  for (const row of rows) {
    if (!row.key.startsWith(PREFIX)) continue;
    try {
      out[row.key.slice(PREFIX.length)] = JSON.parse(row.value);
    } catch {
      // Ignore malformed values; the default stays.
    }
  }
  return out as unknown as Prefs;
}
