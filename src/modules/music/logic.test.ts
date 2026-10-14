import { describe, expect, it } from "vitest";

import { angleDelta, clock, contrast, currentLine, EQ_PRESETS, gainAt, gainsFor, paletteFrom, parseLrc, seekTarget, type Rgb } from "./logic";

const rgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;

describe("lyrics", () => {
  const lrc = "[ar: Coldplay]\n[00:33.80] Look at the stars\n[00:36.23]Look how they shine\n[00:40.43]\n[01:02.10][02:10.00] Chorus";
  const lines = parseLrc(lrc);

  it("reads timed lines, repeated stamps included, in order", () => {
    expect(lines.map((l) => l.at)).toEqual([33800, 36230, 40430, 62100, 130000]);
    expect(lines[1].text).toBe("Look how they shine");
    expect(lines.at(-1)!.text).toBe("Chorus");
  });

  it("finds the line being sung", () => {
    expect(currentLine(lines, 1000)).toBe(-1);
    expect(currentLine(lines, 33800)).toBe(0);
    expect(currentLine(lines, 39000)).toBe(1);
    expect(currentLine(lines, 999_000)).toBe(4);
  });
});

describe("disc", () => {
  it("turns the short way round", () => {
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI);
  });

  it("moves a minute per turn, within the track", () => {
    expect(seekTarget(30_000, Math.PI, 200_000)).toBe(60_000);
    expect(seekTarget(30_000, -4 * Math.PI, 200_000)).toBe(0);
    expect(seekTarget(30_000, 20 * Math.PI, 200_000)).toBe(199_000);
  });

  it("formats times", () => {
    expect(clock(65_400)).toBe("1:05");
    expect(clock(3_725_000)).toBe("1:02:05");
  });
});

describe("equaliser", () => {
  it("interpolates presets onto the phone's bands", () => {
    const bass = EQ_PRESETS.find((p) => p.id === "bass")!.gains;
    expect(gainAt(bass, 31)).toBe(6);
    expect(gainAt(bass, 20)).toBe(6);
    expect(gainAt(bass, 1000)).toBe(0);
    expect(gainAt(bass, 88)).toBeGreaterThan(4);
    expect(gainAt(bass, 88)).toBeLessThan(5);
    expect(gainsFor([20, 0, 0, 0, 0, 0, 0, 0, 0, 0], [31, 14000], -15, 15)).toEqual([15, 0]);
  });

  it("has every preset for every band", () => {
    for (const p of EQ_PRESETS) expect(p.gains).toHaveLength(10);
  });
});

describe("palette", () => {
  const image = (colors: [Rgb, number][]) => colors.flatMap(([c, n]) => Array.from({ length: n }, () => [...c, 255])).flat();

  it("deepens the main colour and picks readable text", () => {
    const p = paletteFrom(image([[[220, 40, 40], 80], [[30, 120, 220], 20]]));
    const bg = rgb(p.bg);
    expect(bg[0]).toBeGreaterThan(bg[1]);
    expect(p.dark).toBe(true);
    expect(p.text).toBe("#ffffff");
    expect(contrast(rgb(p.accent), bg)).toBeGreaterThanOrEqual(3);
  });

  it("keeps pale covers light, with dark text", () => {
    const p = paletteFrom(image([[[245, 242, 235], 90], [[200, 60, 40], 10]]));
    expect(p.dark).toBe(false);
    expect(p.text).toBe("#141418");
    expect(contrast(rgb(p.accent), rgb(p.bg))).toBeGreaterThanOrEqual(3);
  });

  it("copes with an empty image", () => {
    expect(paletteFrom([]).text).toBe("#ffffff");
  });
});
