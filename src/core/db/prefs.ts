/**
 * Device-specific preferences stored in `local_meta` (never synced), e.g.
 * where this device writes its backups.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { eq } from "drizzle-orm";

import { db, schema } from "./client";

export interface Prefs {
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
  /** Evening nudge when a streak would break. */
  "notify.streaks": boolean;
  /** A week and a day before a goal's finish date. */
  "notify.goals": boolean;
  /** Morning summary time (`HH:MM`), or empty for none. */
  "notify.digest": string;
  /** Shared folder to sync through (desktop), or empty. */
  "sync.folder": string;
  /** Laptop address for direct sync (phone): IP or name, optional `:port`. */
  "sync.lanHost": string;
  /** Streak milestones already celebrated: type id -> "since:milestone". */
  "streak.celebrated": Record<string, string>;
  /** The reading session running on this device, if any. */
  "reading.running": { taskId: string; startedAt: number; pausedAt: number | null; pausedMs: number } | null;
  /** When this device last fetched upcoming contests. */
  "practice.contestsAt": number;
  /** Last time followed teams' games were refreshed. */
  "sports.refreshedAt": number;
  /** Units weights are shown and typed in; stored as kg. */
  "gym.unit": "kg" | "lb";
  /** Default rest between sets, in seconds. */
  "gym.rest": number;
  /** Platforms whose contests are shown and announced. */
  "practice.contestPlatforms": string[];
  /** Notify before contests start. */
  "notify.contests": boolean;
  /** Minutes before a contest to notify. */
  "notify.contestsLead": number;
  /** Notify before followed teams' games. */
  "notify.matches": boolean;
  /** Minutes before a game to notify. */
  "notify.matchesLead": number;
  /** Followed teams' results, after their games. Read by Rust too. */
  "notify.results": boolean;
  /** Favourite players' performances, after their games. Read by Rust too. */
  "notify.performances": boolean;
  /** Last searches typed in the palette, newest first. */
  "search.recent": string[];
  /** Items last opened from search, newest first. */
  "search.opened": { module: string; id: string; title: string }[];
  /** Equaliser on this phone: on or off, preset id, and custom gains (dB per phone band). */
  "music.eq": { on: boolean; preset: string; custom: number[] };
  /** Weekly (Sunday evening) and monthly review reminders. */
  "notify.review": boolean;
  /** Visualiser around the disc. */
  "music.visualizer": boolean;
}

export const defaultPrefs: Prefs = {
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
  "notify.streaks": true,
  "notify.goals": true,
  "notify.digest": "07:30",
  "sync.folder": "",
  "sync.lanHost": "",
  "streak.celebrated": {},
  "reading.running": null,
  "practice.contestsAt": 0,
  "sports.refreshedAt": 0,
  "gym.unit": "kg",
  "gym.rest": 90,
  "practice.contestPlatforms": ["codeforces", "leetcode", "atcoder", "codechef"],
  "notify.contests": true,
  "notify.contestsLead": 60,
  "notify.matches": true,
  "notify.matchesLead": 30,
  "notify.results": true,
  "notify.performances": true,
  "search.recent": [],
  "search.opened": [],
  "music.eq": { on: false, preset: "flat", custom: [] },
  "music.visualizer": true,
  "notify.review": true,
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
