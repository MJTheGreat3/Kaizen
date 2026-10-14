import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowsClockwise, Fire, MagnifyingGlass, Plus } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Skeleton } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import type { CpProblem } from "@/core/db/schema";
import { useOpenTarget } from "@/core/shell/openRequest";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { addDaysKey, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { streak, weekStart } from "@/modules/activity/logic";
import { modules } from "@/modules/registry";
import { AccountCard, AccountDialog } from "./Accounts";
import { DifficultyChart, ProgressChart } from "./Charts";
import { reportToast, usePractice, useRefresh, useRefreshContests, useRefreshGithub } from "./data";
import { GithubCard, GithubDialog, IssueList, RecentRepos } from "./GitHub";
import { PLATFORMS, solvedSince, type PlatformInfo } from "./logic";
import { ContestList, LogDialog, ProblemDialog, ProblemRow } from "./Problems";

const mod = modules.find((m) => m.id === "practice")!;
const HUE = mod.hue;

function Card({ title, action, className, children }: { title: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <motion.section variants={rise} className={cn("rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5", className)}>
      <SectionTitle action={action}>{title}</SectionTitle>
      {children}
    </motion.section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[24px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

type Show = "solved" | "unsolved" | "all";

export function PracticePage() {
  const { data, isLoading } = usePractice();
  const refresh = useRefresh();
  const contests = useRefreshContests();
  const github = useRefreshGithub();
  const [editingGithub, setEditingGithub] = useState(false);
  const [editing, setEditing] = useState<PlatformInfo | null>(null);
  const [logging, setLogging] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<string>("all");
  const [show, setShow] = useState<Show>("solved");
  const [limit, setLimit] = useState(5);
  const [contestPlatforms, setContestPlatforms] = usePref("practice.contestPlatforms");

  useOpenTarget(["problems"], !!data, ({ id }) => setOpenId(id));

  const today = todayKey();
  const stats = useMemo(() => {
    if (!data) return null;
    // From the heatmap's events: only the latest problems are kept.
    const byDay = data.solvedByDay;
    const s = streak(new Set(byDay.keys()), { period: "day", min: 1, perWeek: 1, restDays: [], freezesPerMonth: 0 }, today);
    return {
      total: data.accounts.reduce((n, a) => n + a.solved, 0) + data.loggedSolved,
      week: solvedSince(byDay, weekStart(today)),
      month: solvedSince(byDay, `${today.slice(0, 7)}-01`),
      last30: solvedSince(byDay, addDaysKey(today, -29)),
      streak: s,
    };
  }, [data, today]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.problems ?? []).filter(
      (p) =>
        (platform === "all" || p.platform === platform) &&
        (show === "all" || (show === "solved" ? p.solvedAt : !p.solvedAt)) &&
        (!q || p.name.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q)) || p.code.toLowerCase().includes(q)),
    );
  }, [data, query, platform, show]);

  const connected = (data?.accounts ?? []).map((a) => a.id);
  const opened: CpProblem | undefined = data?.problems.find((p) => p.id === openId);

  async function refreshAll() {
    const [reports, , gh] = await Promise.all([
      connected.length ? refresh.mutateAsync(undefined) : Promise.resolve([]),
      contests.mutateAsync(),
      data?.github ? github.mutateAsync() : Promise.resolve(null),
    ]);
    reportToast(reports, gh);
  }
  const refreshing = refresh.isPending || github.isPending;

  return (
    <Page hue={HUE} className="max-w-[1100px]">
      <PageHeader
        title="Practice"
        description="Codeforces, LeetCode, AtCoder, CodeChef and GitHub in one place."
        icon={mod.icon}
        hue={HUE}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void refreshAll()} disabled={refreshing || (!connected.length && !data?.github)} aria-label="Refresh">
              <motion.span className="grid" animate={refreshing ? { rotate: 360 } : { rotate: 0 }} transition={refreshing ? { duration: 1, repeat: Infinity, ease: "linear" } : { duration: 0.3 }}>
                <ArrowsClockwise />
              </motion.span>
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button size="sm" onClick={() => setLogging(true)}>
              <Plus />
              <span className="hidden sm:inline">Log problem</span>
              <span className="sm:hidden">Log</span>
            </Button>
          </div>
        }
      />

      {isLoading || !data || !stats ? (
        <div className="mt-8 grid gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="mt-8 grid gap-4">
          <motion.div variants={rise} className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {PLATFORMS.map((p) => (
              <AccountCard key={p.id} platform={p} account={data.accounts.find((a) => a.id === p.id)} onEdit={() => setEditing(p)} />
            ))}
            <GithubCard account={data.github} onEdit={() => setEditingGithub(true)} className="col-span-2 md:col-span-1" />
          </motion.div>

          {!connected.length && !data.github ? (
            <p className="text-center text-[14px] text-muted-foreground">Connect a site with your public handle to pull in solves, ratings and contests. Problems from anywhere else can be logged by hand.</p>
          ) : null}

          <motion.div variants={rise} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Solved, all sites" value={stats.total.toLocaleString()} />
            <Stat label="This week" value={stats.week} sub={`${stats.month} this month`} />
            <Stat label="Last 30 days" value={stats.last30} sub={`${(stats.last30 / 30).toFixed(1)} a day`} />
            <Stat
              label="Solving streak"
              value={
                <span className="flex items-center gap-1.5">
                  <Fire size={20} weight={stats.streak.current ? "fill" : "regular"} style={{ color: stats.streak.current ? "#e8673a" : undefined }} />
                  {stats.streak.current}
                </span>
              }
              sub={`Best ${stats.streak.longest} days${stats.streak.current && !stats.streak.doneNow ? " · not yet today" : ""}`}
            />
          </motion.div>

          <Card title="Ratings and contributions">
            <ProgressChart ratings={data.ratings} contributions={data.contributions} />
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Recent solves by difficulty">
              <DifficultyChart problems={data.problems} platforms={PLATFORMS.map((p) => p.id)} />
            </Card>
            <Card
              title="Upcoming contests"
              action={
                <div className="flex gap-1" role="group" aria-label="Contest sites">
                  {PLATFORMS.map((p) => {
                    const on = contestPlatforms.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={on}
                        title={`${on ? "Hide" : "Show"} ${p.name} contests`}
                        onClick={() => void setContestPlatforms(on ? contestPlatforms.filter((x) => x !== p.id) : [...contestPlatforms, p.id])}
                        className={cn("grid size-7 place-items-center rounded-full border transition-opacity", on ? "border-border" : "border-transparent opacity-40")}
                      >
                        <span className="size-2.5 rounded-full" style={{ background: p.color }} />
                        <span className="sr-only">{p.name}</span>
                      </button>
                    );
                  })}
                </div>
              }
            >
              <ContestList contests={data.contests} platforms={contestPlatforms} />
            </Card>
          </div>

          {data.github ? (
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Recent repositories">
                <RecentRepos repos={data.repos} handle={data.github.handle} />
              </Card>
              <Card title="Issues">
                <IssueList issues={data.issues} />
              </Card>
            </div>
          ) : null}

          <Card title="Problems">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-40 flex-1">
                <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or topic" className="h-9 pl-9 text-[14px]" aria-label="Filter problems" />
              </div>
              <NativeSelect aria-label="Site" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="all">All sites</option>
                {PLATFORMS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="other">Logged by hand</option>
              </NativeSelect>
              <NativeSelect aria-label="Show" value={show} onChange={(e) => setShow(e.target.value as Show)}>
                <option value="solved">Solved</option>
                <option value="unsolved">Tried, not solved</option>
                <option value="all">All</option>
              </NativeSelect>
            </div>
            {list.length ? (
              <div className="-mx-1 grid">
                {list.slice(0, limit).map((p) => (
                  <ProblemRow key={p.id} problem={p} onOpen={() => setOpenId(p.id)} />
                ))}
                {list.length > limit ? (
                  <button type="button" onClick={() => setLimit((l) => l + 50)} className="mt-2 justify-self-center text-[13px] font-medium text-muted-foreground hover:text-foreground">
                    Show more ({list.length - limit} left)
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="py-8 text-center text-[14px] text-muted-foreground">{data.problems.length ? "Nothing matches." : "Solved problems from connected sites show up here."}</p>
            )}
          </Card>
        </div>
      )}

      {editing ? <AccountDialog key={editing.id} platform={editing} account={data?.accounts.find((a) => a.id === editing.id) ?? null} onClose={() => setEditing(null)} /> : null}
      {editingGithub ? <GithubDialog account={data?.github ?? null} onClose={() => setEditingGithub(false)} /> : null}
      {logging ? <LogDialog onClose={() => setLogging(false)} /> : null}
      {opened ? <ProblemDialog key={opened.id} problem={opened} onClose={() => setOpenId(null)} /> : null}
    </Page>
  );
}

