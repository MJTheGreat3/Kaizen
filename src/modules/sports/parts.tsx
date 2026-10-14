import { useState } from "react";
import { Bell, BellSlash, Broadcast } from "@phosphor-icons/react";

import type { SportGame, StatTable } from "@/core/db/schema";
import { openUrl } from "@/lib/native";
import { cn, timeUntil } from "@/lib/utils";
import { initials, outcome } from "./logic";

/** A remote picture with initials while it loads or when it fails. */
export function Avatar({ src, name, className, square }: { src: string | null | undefined; name: string; className?: string; square?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = src && failed !== src;
  return (
    <span className={cn("relative grid shrink-0 place-items-center overflow-hidden bg-surface-muted text-muted-foreground", square ? "rounded-lg" : "rounded-full", className)}>
      <span className="text-[0.8em] font-semibold" aria-hidden={!!show}>
        {initials(name)}
      </span>
      {show ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
          className={cn("absolute inset-0 size-full", square ? "object-contain p-0.5" : "object-cover object-top")}
        />
      ) : null}
    </span>
  );
}

function when(ms: number, now: number) {
  const d = new Date(ms);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}${ms > now ? `, ${time}` : ""}`;
}

/** A fixture, live game or result. `team` marks the followed side; `onMute` adds a bell for its notifications. */
export function GameRow({ game, team, now, muted, onMute }: { game: SportGame; team?: string; now: number; muted?: boolean; onMute?: () => void }) {
  const result = game.state === "post" && team ? outcome(game, team) : null;
  const side = (name: string, short: string, logo: string | null, score: string | null) => (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar src={logo} name={short || name} square className="size-6 text-[11px]" />
      <span className={cn("truncate text-[14px]", team === name ? "font-semibold" : "font-medium")} title={name}>
        {short || name}
      </span>
      {score !== null ? <span className="ml-auto shrink-0 text-[14px] font-semibold tabular-nums">{score}</span> : null}
    </span>
  );
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => game.url && void openUrl(game.url)}
        className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted"
      >
        <span className="grid min-w-0 gap-1">
          {side(game.home, game.homeShort, game.homeLogo, game.homeScore)}
          {side(game.away, game.awayShort, game.awayLogo, game.awayScore)}
        </span>
        <span className="grid max-w-36 justify-items-end gap-0.5 text-right text-[12px] text-muted-foreground">
          {game.state === "in" ? (
            <span className="flex items-center gap-1 font-medium text-danger">
              <Broadcast size={12} weight="bold" />
              Live
            </span>
          ) : result ? (
            <span
              className={cn(
                "grid size-5 place-items-center rounded-md text-[11px] font-bold",
                result === "W" ? "bg-success/15 text-success" : result === "L" ? "bg-danger/15 text-danger" : "bg-surface-muted text-muted-foreground",
              )}
              aria-label={result === "W" ? "Won" : result === "L" ? "Lost" : "Draw"}
            >
              {result}
            </span>
          ) : (
            <span className="font-medium text-foreground/80">{game.startAt > now ? timeUntil(game.startAt, now) : ""}</span>
          )}
          <span>{when(game.startAt, now)}</span>
          <span className="line-clamp-2">{game.state === "pre" ? [game.title, game.league].filter(Boolean).join(" · ") : game.status}</span>
        </span>
      </button>
      {onMute ? (
        <button
          type="button"
          onClick={onMute}
          aria-pressed={muted}
          aria-label={muted ? "Turn on notifications for this game" : "Mute this game"}
          title={muted ? "Muted: no reminder or result" : "Reminder before, result after"}
          className={cn("grid size-8 shrink-0 place-items-center rounded-lg transition-colors hover:bg-surface-muted", muted ? "text-muted-foreground/60" : "text-muted-foreground")}
        >
          {muted ? <BellSlash size={16} /> : <Bell size={16} />}
        </button>
      ) : null}
    </li>
  );
}

/** A stats table: first column sticks while the rest scroll sideways. */
export function StatsTable({ table }: { table: StatTable }) {
  return (
    <div className="grid gap-2">
      <h4 className="text-[13px] font-semibold text-muted-foreground">{table.title}</h4>
      <div className="-mx-1 overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="bg-surface-muted text-[12px] text-muted-foreground">
              <th className="sticky left-0 z-10 bg-surface-muted px-3 py-2 text-left font-medium" />
              {table.columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => {
              const total = /^(total|career|all competitions)$/i.test(r.label);
              return (
                <tr key={`${r.label}-${i}`} className={cn("border-t border-border", total && "font-semibold")}>
                  <th scope="row" className="sticky left-0 z-10 max-w-44 truncate whitespace-nowrap bg-surface px-3 py-2 text-left font-medium" title={r.label}>
                    {r.label}
                  </th>
                  {r.values.map((v, j) => (
                    <td key={j} className="whitespace-nowrap px-3 py-2 text-right">
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
