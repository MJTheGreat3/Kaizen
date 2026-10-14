/**
 * Pure sports helpers: the sports offered for sessions, followed-sport
 * labels, weekly totals and how games are grouped.
 */
import type { SportGame, SportId, SportSession } from "@/core/db/schema";
import { addDaysKey, type DateKey } from "@/lib/dates";

/** Sports offered when logging a session; anything else can be typed. */
export const SESSION_SPORTS = [
  "Cricket",
  "Football",
  "Basketball",
  "Badminton",
  "Table tennis",
  "Tennis",
  "Volleyball",
  "Swimming",
  "Running",
  "Cycling",
];

export const INTENSITY = ["Easy", "Moderate", "Hard"] as const;

export interface FollowSport {
  id: SportId;
  name: string;
  source: string;
}

export const FOLLOW_SPORTS: FollowSport[] = [
  { id: "nba", name: "NBA", source: "ESPN" },
  { id: "football", name: "Football", source: "ESPN" },
  { id: "cricket", name: "Cricket", source: "Cricbuzz" },
];

export const sportName = (id: string) => FOLLOW_SPORTS.find((s) => s.id === id)?.name ?? id;

/** Favourite players shown in the showcase. */
export const MAX_FAVOURITES = 5;

export function minutesBetween(sessions: Pick<SportSession, "date" | "minutes">[], from: DateKey, to: DateKey) {
  return sessions.filter((s) => s.date >= from && s.date <= to).reduce((n, s) => n + s.minutes, 0);
}

/** Minutes per sport over the sessions given, most played first. */
export function bySport(sessions: Pick<SportSession, "sport" | "minutes">[]) {
  const totals = new Map<string, number>();
  for (const s of sessions) totals.set(s.sport, (totals.get(s.sport) ?? 0) + s.minutes);
  return [...totals].map(([sport, minutes]) => ({ sport, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** Minutes for each of the last `days` days, oldest first. */
export function dailyMinutes(sessions: Pick<SportSession, "date" | "minutes">[], today: DateKey, days: number) {
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysKey(today, i - days + 1);
    return { date, minutes: minutesBetween(sessions, date, date) };
  });
}

/**
 * Games across followed teams: live first, then upcoming soonest first,
 * and results newest first. Two followed teams playing each other show once.
 */
export function splitGames(games: SportGame[], now: number) {
  const seen = new Set<string>();
  const unique = games.filter((g) => {
    const key = `${g.sport}:${g.startAt}:${[g.homeShort, g.awayShort].sort().join("-")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const live = unique.filter((g) => g.state === "in");
  const upcoming = unique.filter((g) => g.state === "pre" && g.startAt > now - 6 * 3_600_000).sort((a, b) => a.startAt - b.startAt);
  const results = unique.filter((g) => g.state === "post").sort((a, b) => b.startAt - a.startAt);
  return { live, upcoming, results };
}

/** "W", "L" or "D" for a followed team in a finished game, when scores are numbers. */
export function outcome(game: Pick<SportGame, "home" | "away" | "homeScore" | "awayScore" | "status">, team: string): "W" | "L" | "D" | null {
  const side = game.home === team ? "home" : game.away === team ? "away" : null;
  if (!side) return null;
  const status = game.status.toLowerCase();
  // Cricket results say who won.
  if (status.includes(" won")) return status.startsWith(team.toLowerCase()) ? "W" : "L";
  if (status.includes("drawn") || status.includes("tied")) return "D";
  const [h, a] = [Number(game.homeScore), Number(game.awayScore)];
  if (!Number.isFinite(h) || !Number.isFinite(a) || game.homeScore === null || game.awayScore === null) return null;
  if (h === a) return "D";
  return (h > a) === (side === "home") ? "W" : "L";
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
