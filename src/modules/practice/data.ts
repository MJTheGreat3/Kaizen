import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { toast } from "sonner";
import { uuidv7 } from "uuidv7";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import { getPref, setPref } from "@/core/db/prefs";
import type { CpAccount, CpContest, CpPlatform, CpProblem, CpRating, GhAccount, GhIssue, GhRepo } from "@/core/db/schema";
import { ipc, type GitHubReport, type PracticeReport } from "@/lib/ipc";
import { toKey, type DateKey } from "@/lib/dates";
import { log } from "@/lib/log";

const a = schema.cpAccounts;
const p = schema.cpProblems;
const g = schema.ghAccount;

export interface PracticeData {
  accounts: CpAccount[];
  /** The most recent problems only (the rest are dropped). */
  problems: CpProblem[];
  /** Problems solved per day, from the heatmap's events (complete history). */
  solvedByDay: Map<DateKey, number>;
  /** Problems logged by hand and solved, ever. */
  loggedSolved: number;
  /** GitHub contributions per day. */
  contributions: Map<DateKey, number>;
  ratings: CpRating[];
  contests: CpContest[];
  github: GhAccount | null;
  repos: GhRepo[];
  issues: GhIssue[];
}

export async function loadPractice(): Promise<PracticeData> {
  const e = schema.activityEvents;
  const [accounts, problems, events, ratings, contests, github, repos, issues] = await Promise.all([
    db.select().from(a).where(isNull(a.deletedAt)),
    db.select().from(p).where(isNull(p.deletedAt)).orderBy(desc(p.solvedAt), desc(p.lastAt)),
    db
      .select({ typeId: e.typeId, date: e.date, quantity: e.quantity, sourceId: e.sourceId })
      .from(e)
      .where(and(isNull(e.deletedAt), sql`${e.typeId} IN ('cp', 'github')`)),
    db.select().from(schema.cpRatings).orderBy(asc(schema.cpRatings.at)),
    loadContests(),
    db.select().from(g).where(isNull(g.deletedAt)).get(),
    db.select().from(schema.ghRepos).orderBy(asc(schema.ghRepos.sort)),
    db.select().from(schema.ghIssues).orderBy(desc(schema.ghIssues.updatedAt)),
  ]);
  const solvedByDay = new Map<DateKey, number>();
  const contributions = new Map<DateKey, number>();
  let loggedSolved = 0;
  for (const ev of events) {
    if (ev.typeId === "github") contributions.set(ev.date, (contributions.get(ev.date) ?? 0) + ev.quantity);
    else {
      solvedByDay.set(ev.date, (solvedByDay.get(ev.date) ?? 0) + 1);
      if (ev.sourceId?.startsWith("x:")) loggedSolved++;
    }
  }
  return { accounts, problems, solvedByDay, loggedSolved, contributions, ratings, contests, github: github ?? null, repos, issues };
}

/** Contests not yet over, soonest first. */
export async function loadContests(): Promise<CpContest[]> {
  const c = schema.cpContests;
  const rows = await db
    .select()
    .from(c)
    .where(gt(c.startAt, Date.now() - 24 * 3_600_000))
    .orderBy(asc(c.startAt));
  return rows.filter((x) => x.startAt + x.durationMin * 60_000 > Date.now());
}

export function usePractice() {
  return useQuery({ queryKey: ["practice"], queryFn: loadPractice });
}

/** Everything a practice change can show up in. */
const AFFECTED = [["practice"], ["activity"], ["goals"], ["today"], ["search-index"]];

function usePracticeMutation<A, R = unknown>(fn: (a: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of AFFECTED) void client.invalidateQueries({ queryKey: key });
    },
  });
}

// ---------------------------------------------------------------------------
// Accounts and refresh
// ---------------------------------------------------------------------------

/**
 * Sets a platform's handle. A different person's handle starts over: the
 * old account's problems are removed (with their heatmap entries).
 */
export async function saveAccount(platform: CpPlatform, handle: string) {
  const existing: CpAccount | undefined = await db.select().from(a).where(eq(a.id, platform)).get();
  const changed = existing && existing.handle.toLowerCase() !== handle.toLowerCase();
  if (changed) {
    const old = await db.select({ id: p.id }).from(p).where(and(eq(p.platform, platform), isNull(p.deletedAt)));
    for (const row of old) {
      await db.update(p).set({ deletedAt: Date.now() }).where(eq(p.id, row.id));
      await clearActivity("cp_problems", row.id);
    }
    await db.delete(schema.cpRatings).where(eq(schema.cpRatings.platform, platform));
  }
  const reset = changed || existing?.deletedAt ? { cursor: 0, rating: null, maxRating: null, rankTitle: null, solved: 0, contests: 0, syncedAt: null, error: null } : {};
  await db
    .insert(a)
    .values({ id: platform, handle })
    .onConflictDoUpdate({ target: a.id, set: { handle, deletedAt: null, ...reset, updatedAt: Date.now() } });
}

export function useSaveAccount() {
  return usePracticeMutation(async ({ platform, handle }: { platform: CpPlatform; handle: string }) => {
    await saveAccount(platform, handle.trim());
    return ipc.practiceRefresh([platform]);
  });
}

export function useRemoveAccount() {
  return usePracticeMutation((platform: CpPlatform) => db.update(a).set({ deletedAt: Date.now() }).where(eq(a.id, platform)));
}

export function useRefresh() {
  return usePracticeMutation((platforms?: CpPlatform[]) => ipc.practiceRefresh(platforms));
}

export function useRefreshContests() {
  return usePracticeMutation(async () => {
    const n = await ipc.practiceContests();
    await setPref("practice.contestsAt", Date.now());
    return n;
  });
}

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

/**
 * Sets the GitHub username. Another person's username starts over: the old
 * account's contributions leave the heatmap and the caches are cleared.
 */
export async function saveGithub(handle: string) {
  const existing: GhAccount | undefined = await db.select().from(g).where(eq(g.id, "github")).get();
  const changed = existing && existing.handle.toLowerCase() !== handle.toLowerCase();
  if (changed) {
    const ae = schema.activityEvents;
    await db
      .update(ae)
      .set({ deletedAt: Date.now() })
      .where(and(eq(ae.typeId, "github"), isNull(ae.deletedAt)));
    await db.delete(schema.ghRepos);
    await db.delete(schema.ghIssues);
  }
  const reset = changed || existing?.deletedAt ? { contributions: 0, meta: {}, syncedAt: null, error: null } : {};
  await db
    .insert(g)
    .values({ id: "github", handle })
    .onConflictDoUpdate({ target: g.id, set: { handle, deletedAt: null, ...reset, updatedAt: Date.now() } });
}

export function useSaveGithub() {
  return usePracticeMutation(async (handle: string) => {
    await saveGithub(handle.trim());
    return ipc.githubRefresh();
  });
}

/** Disconnecting keeps past contributions on the heatmap. */
export function useRemoveGithub() {
  return usePracticeMutation(async () => {
    await db.update(g).set({ deletedAt: Date.now() }).where(eq(g.id, "github"));
    await db.delete(schema.ghRepos);
    await db.delete(schema.ghIssues);
  });
}

export function useRefreshGithub() {
  return usePracticeMutation(() => ipc.githubRefresh());
}

const STALE_MS = 3 * 3_600_000;
const CONTESTS_STALE_MS = 6 * 3_600_000;

/** Refreshes stale accounts and the contest list shortly after unlock, then every half hour. */
export function usePracticeAutoRefresh(enabled: boolean) {
  const refresh = useRefresh();
  const contests = useRefreshContests();
  const github = useRefreshGithub();
  const { mutate: githubMutate } = github;
  const { mutate: refreshMutate } = refresh;
  const { mutate: contestsMutate } = contests;
  useEffect(() => {
    if (!enabled) return;
    const check = async () => {
      try {
        const accounts = await db.select().from(a).where(isNull(a.deletedAt));
        const stale = accounts.filter((x) => !x.syncedAt || Date.now() - x.syncedAt > STALE_MS).map((x) => x.id);
        if (stale.length) refreshMutate(stale);
        const gh = await db.select().from(g).where(isNull(g.deletedAt)).get();
        if (gh && (!gh.syncedAt || Date.now() - gh.syncedAt > STALE_MS)) githubMutate();
        if (Date.now() - (await getPref("practice.contestsAt")) > CONTESTS_STALE_MS) contestsMutate();
      } catch (e) {
        log.warn(`practice refresh check failed: ${String(e)}`);
      }
    };
    const first = setTimeout(check, 20_000);
    const interval = setInterval(check, 30 * 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(interval);
    };
  }, [enabled, refreshMutate, contestsMutate, githubMutate]);
}

/** Toast for a manual refresh: new solves, or what failed. */
export function reportToast(reports: PracticeReport[], github?: GitHubReport | null) {
  const solves = reports.reduce((n, x) => n + x.newSolves, 0);
  const errors = [...reports, ...(github ? [github] : [])].filter((x) => x.error);
  if (errors.length) toast.error(errors.map((e) => e.error).join("\n"));
  else toast.success(solves ? `${solves} new ${solves === 1 ? "solve" : "solves"}` : "Up to date");
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export function useUpdateProblem() {
  return usePracticeMutation(({ id, ...patch }: Partial<Pick<CpProblem, "notes" | "minutes" | "solutionUrl" | "name" | "url" | "difficulty" | "tags">> & { id: string }) =>
    db.update(p).set(patch).where(eq(p.id, id)),
  );
}

export interface LogInput {
  name: string;
  source: string;
  url: string | null;
  difficulty: string | null;
  tags: string[];
  date: DateKey;
  solved: boolean;
  minutes: number | null;
  notes: string | null;
}

/** Problems kept; older ones are dropped, as the Rust fetch does (`KEEP_PROBLEMS`). */
const KEEP_PROBLEMS = 30;

async function pruneProblems() {
  await db.run(sql`DELETE FROM cp_problems WHERE id NOT IN (
    SELECT id FROM cp_problems WHERE deleted_at IS NULL
    ORDER BY coalesce(solved_at, last_at, first_at, 0) DESC LIMIT ${KEEP_PROBLEMS})`);
  await db.run(sql`DELETE FROM sync_clock WHERE table_name = 'cp_problems' AND row_id NOT IN (SELECT id FROM cp_problems)`);
}

/** A problem from anywhere (CSES, a book, a contest on another site), logged by hand. */
export async function logProblem(input: LogInput) {
  const id = `x:${uuidv7()}`;
  const at = new Date(`${input.date}T12:00:00`).getTime();
  await db.insert(p).values({
    id,
    platform: "other",
    code: input.source || "Other",
    name: input.name,
    url: input.url,
    difficulty: input.difficulty,
    rating: input.difficulty && /^\d+$/.test(input.difficulty) ? Number(input.difficulty) : null,
    tags: input.tags,
    attempts: 1,
    firstAt: at,
    lastAt: at,
    solvedAt: input.solved ? at : null,
    minutes: input.minutes,
    notes: input.notes,
  });
  if (input.solved) await recordActivity("cp", input.date, "cp_problems", id);
  await pruneProblems();
  return id;
}

export function useLogProblem() {
  return usePracticeMutation(logProblem);
}

export function useDeleteProblem() {
  return usePracticeMutation(async (id: string) => {
    await db.update(p).set({ deletedAt: Date.now() }).where(eq(p.id, id));
    await clearActivity("cp_problems", id);
  });
}

/** Marks a logged problem solved (or not) on a day. */
export function useSetLoggedSolved() {
  return usePracticeMutation(async ({ problem, solved }: { problem: CpProblem; solved: boolean }) => {
    const at = solved ? (problem.lastAt ?? Date.now()) : null;
    await db.update(p).set({ solvedAt: at }).where(eq(p.id, problem.id));
    if (at) await recordActivity("cp", toKey(new Date(at)), "cp_problems", problem.id);
    else await clearActivity("cp_problems", problem.id);
  });
}
