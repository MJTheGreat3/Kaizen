import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowsClockwise, Fire, Plus, Trash, Warning } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { RowMenu, SectionTitle } from "@/components/ui/kit";
import type { SportSession } from "@/core/db/schema";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { addDaysKey, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { activeDays, streak, weekStart } from "@/modules/activity/logic";
import { amount } from "@/modules/activity/format";
import { modules } from "@/modules/registry";
import { sportsToast, useRefreshSports, useSports, useUnfollow } from "./data";
import { FollowDialog, SessionDialog } from "./Dialogs";
import { INTENSITY, bySport, minutesBetween, sportName, splitGames } from "./logic";
import { Avatar, GameRow } from "./parts";
import { Showcase } from "./Showcase";

const mod = modules.find((m) => m.id === "sports")!;
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
      <p className="mt-1 truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-1 truncate text-[12px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

export function SportsPage() {
  const { data, isLoading } = useSports();
  const refresh = useRefreshSports();
  const unfollow = useUnfollow();
  const now = useNow(60_000).getTime();
  const [following, setFollowing] = useState<"team" | "player" | null>(null);
  const [editing, setEditing] = useState<SportSession | "new" | null>(null);
  const [allSessions, setAllSessions] = useState(false);
  const today = todayKey();

  const stats = useMemo(() => {
    if (!data) return null;
    const totals = new Map<string, number>();
    for (const s of data.sessions) totals.set(s.date, (totals.get(s.date) ?? 0) + s.minutes);
    const month = data.sessions.filter((s) => s.date >= `${today.slice(0, 7)}-01`);
    return {
      week: minutesBetween(data.sessions, weekStart(today), today),
      lastWeek: minutesBetween(data.sessions, addDaysKey(weekStart(today), -7), addDaysKey(weekStart(today), -1)),
      month,
      top: bySport(data.sessions.filter((s) => s.date >= addDaysKey(today, -29)))[0],
      streak: streak(activeDays(totals, data.rule), data.rule, today),
    };
  }, [data, today]);

  const games = useMemo(() => splitGames(data?.games ?? [], now), [data, now]);
  const teamOf = (followId: string) => data?.teams.find((t) => t.id === followId)?.name;
  const recentSports = useMemo(() => [...new Set((data?.sessions ?? []).map((s) => s.sport))].slice(0, 4), [data]);

  async function refreshAll() {
    sportsToast(await refresh.mutateAsync(undefined));
  }

  return (
    <Page hue={HUE} className="max-w-[1100px]">
      <PageHeader
        title="Sports"
        description="Your games, and the teams and players you follow."
        icon={mod.icon}
        hue={HUE}
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void refreshAll()} disabled={refresh.isPending || !(data?.teams.length || data?.players.length)} aria-label="Refresh">
              <motion.span className="grid" animate={refresh.isPending ? { rotate: 360 } : { rotate: 0 }} transition={refresh.isPending ? { duration: 1, repeat: Infinity, ease: "linear" } : { duration: 0.3 }}>
                <ArrowsClockwise />
              </motion.span>
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus />
              <span className="hidden sm:inline">Log session</span>
              <span className="sm:hidden">Log</span>
            </Button>
          </div>
        }
      />

      {isLoading || !data || !stats ? (
        <div className="mt-8 grid gap-4">
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : (
        <div className="mt-8 grid gap-4">
          <motion.section variants={rise} className="grid min-w-0 gap-3">
            <SectionTitle
              action={
                data.players.length ? (
                  <Link to="/sports/players" search={{ p: data.players[0]!.id }} className="text-[13px] font-medium text-muted-foreground hover:text-foreground">
                    All stats
                  </Link>
                ) : null
              }
            >
              Favourite players
            </SectionTitle>
            <Showcase players={data.players} stats={data.stats} hue={HUE} onAdd={() => setFollowing("player")} />
          </motion.section>

          <motion.div variants={rise} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="This week" value={amount("sports", stats.week)} sub={`${amount("sports", stats.lastWeek)} last week`} />
            <Stat label="This month" value={`${stats.month.length} ${stats.month.length === 1 ? "session" : "sessions"}`} sub={amount("sports", stats.month.reduce((n, s) => n + s.minutes, 0))} />
            <Stat label="Most played" value={stats.top?.sport ?? "–"} sub={stats.top ? `${amount("sports", stats.top.minutes)} in 30 days` : "Last 30 days"} />
            <Stat
              label="Playing streak"
              value={
                <span className="flex items-center gap-1.5">
                  <Fire size={20} weight={stats.streak.current ? "fill" : "regular"} style={{ color: stats.streak.current ? HUE : undefined }} />
                  {stats.streak.current}
                </span>
              }
              sub={`${stats.streak.unit === "weeks" ? "weeks" : "days"} · best ${stats.streak.longest}`}
            />
          </motion.div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title={games.live.length ? "Live and upcoming" : "Upcoming"}>
              {games.live.length + games.upcoming.length ? (
                <ul className="-mx-1 grid gap-0.5">
                  {[...games.live, ...games.upcoming.slice(0, 6)].map((g) => (
                    <GameRow key={g.id} game={g} team={teamOf(g.followId)} now={now} />
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-[14px] text-muted-foreground">{data.teams.length ? "No fixtures found yet." : "Follow a team to see its fixtures."}</p>
              )}
            </Card>
            <Card title="Results">
              {games.results.length ? (
                <ul className="-mx-1 grid gap-0.5">
                  {games.results.slice(0, 6).map((g) => (
                    <GameRow key={g.id} game={g} team={teamOf(g.followId)} now={now} />
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-[14px] text-muted-foreground">{data.teams.length ? "No recent results." : "Results of followed teams show here."}</p>
              )}
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card
              title="Following"
              action={
                <Button size="sm" variant="ghost" onClick={() => setFollowing("team")}>
                  <Plus />
                  Team
                </Button>
              }
            >
              {data.teams.length ? (
                <ul className="-mx-1 grid gap-0.5">
                  {data.teams.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5">
                      <Avatar src={t.image} name={t.name} square className="size-8 text-[12px]" />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate text-[14px] font-medium">{t.name}</span>
                        <span className="flex items-center gap-1 truncate text-[12px] text-muted-foreground">
                          {t.error ? <Warning size={12} className="shrink-0 text-danger" /> : null}
                          <span className="truncate">{t.error ?? [sportName(t.sport), t.subtitle].filter(Boolean).join(" · ")}</span>
                        </span>
                      </span>
                      <RowMenu items={[{ label: "Unfollow", icon: Trash, danger: true, onSelect: () => unfollow.mutate(t.id) }]} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-6 text-center text-[14px] text-muted-foreground">NBA, football and cricket teams, from any league.</p>
              )}
            </Card>

            <Card title="Your sessions">
              {data.sessions.length ? (
                <ul className="-mx-1 grid gap-0.5">
                  {data.sessions.slice(0, allSessions ? undefined : 5).map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => setEditing(s)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted">
                        <span className="grid min-w-0 flex-1">
                          <span className="truncate text-[14px] font-medium">{s.sport}</span>
                          <span className="truncate text-[12px] text-muted-foreground">
                            {new Date(`${s.date}T12:00:00`).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}
                            {s.intensity ? ` · ${INTENSITY[s.intensity - 1]}` : ""}
                            {s.notes ? ` · ${s.notes}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-[13px] font-medium tabular-nums text-muted-foreground">{amount("sports", s.minutes)}</span>
                      </button>
                    </li>
                  ))}
                  {!allSessions && data.sessions.length > 5 ? (
                    <button type="button" onClick={() => setAllSessions(true)} className="mt-2 justify-self-center text-[13px] font-medium text-muted-foreground hover:text-foreground">
                      Show all {data.sessions.length}
                    </button>
                  ) : null}
                </ul>
              ) : (
                <p className="py-6 text-center text-[14px] text-muted-foreground">Log a game or practice to see it here and on the heatmap.</p>
              )}
            </Card>
          </div>
        </div>
      )}

      {following ? <FollowDialog kind={following} follows={[...(data?.teams ?? []), ...(data?.players ?? [])]} onClose={() => setFollowing(null)} /> : null}
      {editing ? <SessionDialog session={editing === "new" ? null : editing} recent={recentSports} onClose={() => setEditing(null)} /> : null}
    </Page>
  );
}
