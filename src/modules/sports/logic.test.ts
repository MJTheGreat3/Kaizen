import { describe, expect, it } from "vitest";

import type { SportGame } from "@/core/db/schema";
import { bySport, dailyMinutes, initials, minutesBetween, outcome, splitGames } from "./logic";

const game = (g: Partial<SportGame>): SportGame => ({
  id: "x",
  followId: "f",
  sport: "nba",
  startAt: 0,
  league: null,
  title: null,
  home: "Warriors",
  homeShort: "GS",
  homeLogo: null,
  homeScore: null,
  away: "Lakers",
  awayShort: "LAL",
  awayLogo: null,
  awayScore: null,
  state: "pre",
  status: "",
  url: null,
  ...g,
});

describe("sports", () => {
  it("adds up session minutes", () => {
    const sessions = [
      { sport: "Cricket", date: "2026-10-12", minutes: 90 },
      { sport: "Badminton", date: "2026-10-13", minutes: 45 },
      { sport: "Cricket", date: "2026-10-14", minutes: 60 },
    ];
    expect(minutesBetween(sessions, "2026-10-13", "2026-10-14")).toBe(105);
    expect(bySport(sessions)).toEqual([
      { sport: "Cricket", minutes: 150 },
      { sport: "Badminton", minutes: 45 },
    ]);
    expect(dailyMinutes(sessions, "2026-10-14", 3).map((d) => d.minutes)).toEqual([90, 45, 60]);
  });

  it("splits games and shows a game between two followed teams once", () => {
    const now = 1_000_000;
    const games = [
      game({ id: "1", followId: "a", state: "post", startAt: 10 }),
      game({ id: "2", followId: "b", state: "post", startAt: 10 }),
      game({ id: "3", state: "post", startAt: 20, homeShort: "GS", awayShort: "POR" }),
      game({ id: "4", state: "pre", startAt: now + 5 }),
      game({ id: "5", state: "pre", startAt: now + 1, awayShort: "MEM" }),
      game({ id: "6", state: "in", startAt: now - 5, awayShort: "DEN" }),
    ];
    const { live, upcoming, results } = splitGames(games, now);
    expect(live.map((g) => g.id)).toEqual(["6"]);
    expect(upcoming.map((g) => g.id)).toEqual(["5", "4"]);
    expect(results.map((g) => g.id)).toEqual(["3", "1"]);
  });

  it("reads who won", () => {
    expect(outcome(game({ homeScore: "104", awayScore: "101" }), "Warriors")).toBe("W");
    expect(outcome(game({ homeScore: "1", awayScore: "3" }), "Warriors")).toBe("L");
    expect(outcome(game({ homeScore: "2", awayScore: "2" }), "Lakers")).toBe("D");
    expect(outcome(game({ home: "India", away: "West Indies", homeScore: "223", awayScore: "209/7", status: "India won by 14 runs" }), "West Indies")).toBe("L");
    expect(outcome(game({ home: "India", away: "West Indies", homeScore: "223", awayScore: "209/7", status: "India won by 14 runs" }), "India")).toBe("W");
    expect(outcome(game({}), "Warriors")).toBeNull();
    expect(initials("Virat Kohli")).toBe("VK");
  });
});
