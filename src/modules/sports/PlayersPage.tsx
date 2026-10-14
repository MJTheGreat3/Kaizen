import { motion } from "motion/react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ArrowLeft, ArrowsClockwise, CaretLeft, CaretRight, Plus, Trash, Warning } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { SectionTitle } from "@/components/ui/kit";
import { Page } from "@/core/shell/PageHeader";
import { rise } from "@/lib/motion";
import { cn, timeAgo } from "@/lib/utils";
import { modules, pathOf } from "@/modules/registry";
import { useMovePlayer, useRefreshSports, useSports, useUnfollow } from "./data";
import { FollowDialog } from "./Dialogs";
import { MAX_FAVOURITES, sportName } from "./logic";
import { Avatar, StatsTable } from "./parts";

const HUE = modules.find((m) => m.id === "sports")!.hue;

/** Favourite players' season and career stats, one player at a time. */
export function PlayersPage() {
  const { p } = useSearch({ from: "/sports/players" });
  const navigate = useNavigate();
  const { data, isLoading } = useSports();
  const refresh = useRefreshSports();
  const unfollow = useUnfollow();
  const move = useMovePlayer();
  const [adding, setAdding] = useState(false);

  const players = data?.players ?? [];
  const index = Math.max(0, players.findIndex((x) => x.id === p));
  const player = players[index];
  const stat = player ? data?.stats.get(player.id) : undefined;
  const s = stat?.data;
  const select = (id: string) => void navigate({ to: "/sports/players", search: { p: id }, replace: true });

  return (
    <Page hue={HUE} className="max-w-[1100px]">
      <motion.div variants={rise} className="flex items-center justify-between gap-2">
        <Link to={pathOf("sports")} className="flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} />
          Sports
        </Link>
        {players.length < MAX_FAVOURITES ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus />
            Add player
          </Button>
        ) : null}
      </motion.div>

      {isLoading || !data ? (
        <div className="mt-6 grid gap-4">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : !player ? (
        <motion.div variants={rise} className="mt-16 grid justify-items-center gap-3 text-center">
          <p className="text-[15px] text-muted-foreground">No favourite players yet.</p>
          <Button onClick={() => setAdding(true)}>
            <Plus />
            Add a favourite
          </Button>
        </motion.div>
      ) : (
        <div className="mt-6 grid gap-5">
          <motion.div variants={rise} role="tablist" aria-label="Favourite players" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
            {players.map((x) => (
              <button
                key={x.id}
                type="button"
                role="tab"
                aria-selected={x.id === player.id}
                onClick={() => select(x.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-[13px] font-medium transition-colors",
                  x.id === player.id ? "border-transparent bg-accent text-accent-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground",
                )}
              >
                <Avatar src={data.stats.get(x.id)?.data.image ?? x.image} name={x.name} className="size-7 text-[11px]" />
                {x.name}
              </button>
            ))}
          </motion.div>

          <motion.section
            key={player.id}
            variants={rise}
            className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-soft md:p-6"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${HUE} 16%, transparent), transparent 60%)` }}
            />
            <div className="relative flex flex-wrap items-start gap-4">
              <Avatar src={s?.image ?? player.image} name={player.name} className="size-20 text-[24px] ring-4 ring-surface md:size-28" />
              <div className="grid min-w-0 flex-1 basis-40 gap-1">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{sportName(player.sport)}</span>
                <h1 className="text-[26px] font-semibold leading-tight tracking-tight md:text-[30px]">{player.name}</h1>
                <p className="text-[14px] text-muted-foreground">{s ? [s.team, s.position].filter(Boolean).join(" · ") : player.subtitle}</p>
                <p className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  {player.error ? (
                    <>
                      <Warning size={12} className="text-danger" />
                      <span className="text-danger">{player.error}</span>
                    </>
                  ) : stat ? (
                    `Updated ${timeAgo(stat.fetchedAt)}`
                  ) : (
                    "Fetching stats…"
                  )}
                </p>
              </div>
              <div className="flex gap-1 max-sm:-mb-2 max-sm:w-full max-sm:justify-end max-sm:border-t max-sm:border-border max-sm:pt-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Refresh stats"
                  disabled={refresh.isPending}
                  onClick={async () => {
                    const r = await refresh.mutateAsync([player.id]);
                    if (r.errors.length) toast.error(r.errors[0]);
                  }}
                >
                  <ArrowsClockwise />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Move left" disabled={index === 0} onClick={() => move.mutate({ players, id: player.id, by: -1 })}>
                  <CaretLeft />
                </Button>
                <Button size="sm" variant="ghost" aria-label="Move right" disabled={index === players.length - 1} onClick={() => move.mutate({ players, id: player.id, by: 1 })}>
                  <CaretRight />
                </Button>
                <Button
                  size="sm"
                  variant="danger-ghost"
                  aria-label="Remove from favourites"
                  onClick={() => {
                    unfollow.mutate(player.id);
                    const next = players[index + 1] ?? players[index - 1];
                    if (next) select(next.id);
                  }}
                >
                  <Trash />
                </Button>
              </div>
            </div>
            {s?.highlights.length ? (
              <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {s.highlights.map((h) => (
                  <div key={h.label} className="rounded-xl bg-surface-muted/70 px-3 py-2.5">
                    <p className="text-[22px] font-semibold leading-none tracking-tight tabular-nums">{h.value}</p>
                    <p className="mt-1 text-[12px] text-muted-foreground">{h.label}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </motion.section>

          {s ? (
            <>
              <motion.section variants={rise} className="grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
                <SectionTitle>{player.sport === "cricket" ? "This season: recent form" : `This season · ${s.seasonLabel}`}</SectionTitle>
                {s.season.length ? s.season.map((t) => <StatsTable key={t.title} table={t} />) : <p className="text-[14px] text-muted-foreground">No games this season yet.</p>}
              </motion.section>
              <motion.section variants={rise} className="grid gap-4 rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
                <SectionTitle>All time</SectionTitle>
                {s.career.length ? s.career.map((t) => <StatsTable key={t.title} table={t} />) : <p className="text-[14px] text-muted-foreground">No career stats found.</p>}
              </motion.section>
            </>
          ) : (
            <Skeleton className="h-64 rounded-2xl" />
          )}
        </div>
      )}

      {adding ? <FollowDialog kind="player" follows={[...(data?.teams ?? []), ...players]} onClose={() => setAdding(false)} /> : null}
    </Page>
  );
}
