import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { toast } from "sonner";
import { uuidv7 } from "uuidv7";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import { getPref, setPref } from "@/core/db/prefs";
import type { SportFollow, SportGame, SportSession, SportStat } from "@/core/db/schema";
import { ipc, type SportCandidate, type SportsReport } from "@/lib/ipc";
import type { DateKey } from "@/lib/dates";
import { log } from "@/lib/log";
import { ruleFor, type ActiveRule } from "@/modules/activity/logic";
import { MAX_FAVOURITES } from "./logic";

const s = schema.sportSessions;
const f = schema.sportFollows;

export interface SportsData {
  sessions: SportSession[];
  teams: SportFollow[];
  players: SportFollow[];
  games: SportGame[];
  stats: Map<string, SportStat>;
  /** The heatmap's active-day rule for Sports, for the streak. */
  rule: ActiveRule;
}

export async function loadSports(): Promise<SportsData> {
  const [sessions, follows, games, stats, type] = await Promise.all([
    db.select().from(s).where(isNull(s.deletedAt)).orderBy(desc(s.date), desc(s.createdAt)),
    db.select().from(f).where(isNull(f.deletedAt)).orderBy(asc(f.sort), asc(f.createdAt)),
    db.select().from(schema.sportGames).orderBy(asc(schema.sportGames.startAt)),
    db.select().from(schema.sportStats),
    db.select().from(schema.activityTypes).where(eq(schema.activityTypes.id, "sports")).get(),
  ]);
  return {
    sessions,
    teams: follows.filter((x) => x.kind === "team"),
    players: follows.filter((x) => x.kind === "player").slice(0, MAX_FAVOURITES),
    games,
    stats: new Map(stats.map((x) => [x.id, x])),
    rule: ruleFor("sports", type?.activeDayRule),
  };
}

export function useSports() {
  return useQuery({ queryKey: ["sports"], queryFn: loadSports });
}

const AFFECTED = [["sports"], ["activity"], ["goals"], ["today"], ["search-index"]];

function useSportsMutation<A, R = unknown>(fn: (a: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of AFFECTED) void client.invalidateQueries({ queryKey: key });
    },
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionInput {
  id?: string;
  sport: string;
  date: DateKey;
  minutes: number;
  intensity: number | null;
  notes: string | null;
}

export function useSaveSession() {
  return useSportsMutation(async ({ id, ...input }: SessionInput) => {
    const sessionId = id ?? uuidv7();
    if (id) await db.update(s).set(input).where(eq(s.id, id));
    else await db.insert(s).values({ id: sessionId, ...input });
    await recordActivity("sports", input.date, "sport_sessions", sessionId, input.minutes);
  });
}

export function useDeleteSession() {
  return useSportsMutation(async (id: string) => {
    await db.update(s).set({ deletedAt: Date.now() }).where(eq(s.id, id));
    await clearActivity("sport_sessions", id);
  });
}

// ---------------------------------------------------------------------------
// Following
// ---------------------------------------------------------------------------

export function useSearchSports(sport: string, kind: string, query: string) {
  return useQuery({
    queryKey: ["sports-search", sport, kind, query],
    queryFn: () => ipc.sportsSearch(sport, kind, query),
    enabled: query.trim().length >= 2,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useFollow() {
  return useSportsMutation(async (c: SportCandidate) => {
    const existing = await db.select().from(f).where(isNull(f.deletedAt));
    if (c.kind === "player" && existing.filter((x) => x.kind === "player").length >= MAX_FAVOURITES) {
      throw new Error(`The showcase holds ${MAX_FAVOURITES} players. Remove one first.`);
    }
    const sort = Math.max(0, ...existing.filter((x) => x.kind === c.kind).map((x) => x.sort + 1));
    const values = { sport: c.sport, kind: c.kind, ref: c.ref, name: c.name, subtitle: c.subtitle, league: c.league, image: c.image, sort };
    await db
      .insert(f)
      .values({ id: c.id, ...values })
      .onConflictDoUpdate({ target: f.id, set: { ...values, deletedAt: null, error: null, updatedAt: Date.now() } });
    return ipc.sportsRefresh([c.id]);
  });
}

export function useUnfollow() {
  return useSportsMutation(async (id: string) => {
    await db.update(f).set({ deletedAt: Date.now() }).where(eq(f.id, id));
    await db.delete(schema.sportGames).where(eq(schema.sportGames.followId, id));
    await db.delete(schema.sportStats).where(eq(schema.sportStats.id, id));
  });
}

/** Moves a favourite one place left or right in the showcase. */
export function useMovePlayer() {
  return useSportsMutation(async ({ players, id, by }: { players: SportFollow[]; id: string; by: -1 | 1 }) => {
    const order = players.map((p) => p.id);
    const i = order.indexOf(id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j]!, order[i]!];
    for (const [sort, pid] of order.entries()) {
      await db
        .update(f)
        .set({ sort })
        .where(and(eq(f.id, pid), isNull(f.deletedAt)));
    }
  });
}

export function useRefreshSports() {
  return useSportsMutation(async (ids?: string[]) => {
    const report = await ipc.sportsRefresh(ids);
    if (!ids) await setPref("sports.refreshedAt", Date.now());
    return report;
  });
}

export function sportsToast(report: SportsReport) {
  if (report.errors.length) toast.error([...new Set(report.errors)].join("\n"));
  else toast.success(report.updated ? "Scores and stats updated" : "Up to date");
}

const STALE_MS = 60 * 60_000;

/** Refreshes games and stats shortly after unlock, then every half hour when over an hour old. */
export function useSportsAutoRefresh(enabled: boolean) {
  const { mutate } = useRefreshSports();
  useEffect(() => {
    if (!enabled) return;
    const check = async () => {
      try {
        const follows = await db.select({ id: f.id }).from(f).where(isNull(f.deletedAt)).limit(1);
        if (follows.length && Date.now() - (await getPref("sports.refreshedAt")) > STALE_MS) mutate(undefined);
      } catch (e) {
        log.warn(`sports refresh check failed: ${String(e)}`);
      }
    };
    const first = setTimeout(check, 25_000);
    const interval = setInterval(check, 30 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [enabled, mutate]);
}
