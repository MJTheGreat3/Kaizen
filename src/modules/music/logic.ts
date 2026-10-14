// ---------------------------------------------------------------------------
// Lyrics
// ---------------------------------------------------------------------------

export interface LyricLine {
  /** Start, in ms. */
  at: number;
  text: string;
}

/** Timed lines from LRC text (`[mm:ss.xx] words`, several stamps per line allowed), in order. */
export function parseLrc(lrc: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d{1,2}(?:[.:]\d{1,3})?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const s of stamps) {
      const secs = Number(s[2].replace(":", "."));
      out.push({ at: Math.round((Number(s[1]) * 60 + secs) * 1000), text });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Index of the line being sung at `ms`, or -1 before the first. */
export function currentLine(lines: LyricLine[], ms: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].at <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Disc
// ---------------------------------------------------------------------------

/** One full turn of the disc moves the song by this much. */
export const MS_PER_TURN = 60_000;

/** Angle change between two pointer angles (radians), taking the short way round. */
export function angleDelta(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Where turning the disc by `radians` from `start` lands, within the track. */
export function seekTarget(start: number, radians: number, duration: number): number {
  const ms = start + (radians / (2 * Math.PI)) * MS_PER_TURN;
  return Math.round(Math.min(Math.max(ms, 0), Math.max(duration - 1000, 0)));
}

/** `m:ss`, or `h:mm:ss` for long episodes. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// Equaliser
// ---------------------------------------------------------------------------

/** The bands presets are written for (Hz); the phone's own bands are interpolated from these. */
export const PRESET_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export interface EqPreset {
  id: string;
  name: string;
  /** Gain in dB at each of `PRESET_BANDS`. */
  gains: number[];
}

export const EQ_PRESETS: EqPreset[] = [
  { id: "flat", name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "bass", name: "Bass boost", gains: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0] },
  { id: "treble", name: "Treble boost", gains: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: "vocal", name: "Vocal", gains: [-2, -2, -1, 1, 3, 4, 3, 1, 0, -1] },
  { id: "rock", name: "Rock", gains: [5, 4, 2, -1, -2, -1, 1, 3, 4, 5] },
  { id: "pop", name: "Pop", gains: [-1, 0, 2, 3, 4, 3, 1, 0, -1, -1] },
  { id: "hiphop", name: "Hip-hop", gains: [5, 5, 3, 1, -1, -1, 1, 0, 2, 3] },
  { id: "electronic", name: "Electronic", gains: [5, 4, 1, 0, -2, 2, 1, 2, 4, 5] },
  { id: "jazz", name: "Jazz", gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { id: "classical", name: "Classical", gains: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4] },
  { id: "acoustic", name: "Acoustic", gains: [4, 3, 2, 1, 2, 2, 3, 3, 2, 1] },
  { id: "loudness", name: "Loudness", gains: [6, 4, 1, 0, -1, 0, -1, 1, 4, 5] },
  { id: "night", name: "Late night", gains: [3, 2, 1, 0, 0, 1, 2, 1, -1, -3] },
];

/** A preset's gain at any frequency, interpolated on a log scale between its bands. */
export function gainAt(gains: number[], hz: number): number {
  const f = Math.log(hz);
  const xs = PRESET_BANDS.map(Math.log);
  if (f <= xs[0]) return gains[0];
  if (f >= xs.at(-1)!) return gains.at(-1)!;
  const i = xs.findIndex((x) => x > f) - 1;
  const t = (f - xs[i]) / (xs[i + 1] - xs[i]);
  return Math.round((gains[i] + t * (gains[i + 1] - gains[i])) * 10) / 10;
}

/** A preset's gains for the device's band centres, clamped to its range. */
export function gainsFor(gains: number[], centers: number[], min = -15, max = 15): number[] {
  return centers.map((hz) => Math.min(max, Math.max(min, gainAt(gains, hz))));
}

/** "60 Hz", "1.2 kHz". */
export function hz(f: number): string {
  return f >= 1000 ? `${Math.round(f / 100) / 10} kHz` : `${Math.round(f)} Hz`;
}

// ---------------------------------------------------------------------------
// Colours from the cover
// ---------------------------------------------------------------------------

export type Rgb = [number, number, number];

export interface Palette {
  /** Page background (a deep version of the cover's main colour). */
  bg: string;
  /** Second gradient stop. */
  bg2: string;
  /** Visualiser, progress ring and highlights. */
  accent: string;
  text: string;
  /** Background is dark (text is light). */
  dark: boolean;
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** Relative luminance (WCAG). */
export function luminance([r, g, b]: Rgb): number {
  const c = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Moves a colour's lightness until it has `ratio` contrast with `against`. */
function separate(c: Rgb, against: Rgb, ratio: number): Rgb {
  const [h, s, l] = toHsl(c);
  const up = luminance(against) < 0.3;
  let out = c;
  for (let step = 0; step <= 20 && contrast(out, against) < ratio; step++) {
    out = fromHsl(h, s, Math.min(0.97, Math.max(0.03, l + (up ? 1 : -1) * step * 0.04)));
  }
  return out;
}

/**
 * A palette from RGBA pixels of the cover: the most common colour (weighted
 * a little towards colourful ones) becomes the background, kept deep enough
 * to read on; the most vivid colour that differs from it becomes the accent;
 * the text is white or near-black, whichever reads better.
 */
export function paletteFrom(pixels: Uint8ClampedArray | number[]): Palette {
  const buckets = new Map<number, { n: number; sum: Rgb }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const cell = buckets.get(key) ?? { n: 0, sum: [0, 0, 0] as Rgb };
    cell.n++;
    cell.sum = [cell.sum[0] + r, cell.sum[1] + g, cell.sum[2] + b];
    buckets.set(key, cell);
  }
  const colors = [...buckets.values()].map(({ n, sum }) => ({ n, c: [sum[0] / n, sum[1] / n, sum[2] / n] as Rgb }));
  if (!colors.length) colors.push({ n: 1, c: [40, 40, 48] });
  const main = colors.reduce((best, x) => {
    const score = (y: typeof x) => y.n * (0.6 + toHsl(y.c)[1]);
    return score(x) > score(best) ? x : best;
  }).c;

  const [h, s, l] = toHsl(main);
  // Deep backgrounds suit most covers; very light covers keep a light page.
  const lightPage = l > 0.78 && s < 0.35;
  const base = lightPage ? fromHsl(h, Math.min(s, 0.25), 0.9) : fromHsl(h, Math.min(0.75, s * 1.05), Math.min(0.3, Math.max(0.14, l * 0.55)));
  const bg2 = lightPage ? fromHsl(h, Math.min(s, 0.2), 0.82) : fromHsl(h, Math.min(0.8, s), Math.max(0.06, toHsl(base)[2] * 0.45));

  const vivid = colors
    .filter((x) => x.n >= 2)
    .map((x) => ({ ...x, hsl: toHsl(x.c) }))
    .filter((x) => x.hsl[1] > 0.25 && Math.abs(x.hsl[0] - h) > 18)
    .sort((a, b) => b.hsl[1] * Math.sqrt(b.n) - a.hsl[1] * Math.sqrt(a.n))[0];
  const accentSeed = vivid ? vivid.c : fromHsl(h, Math.max(0.55, s), lightPage ? 0.4 : 0.65);
  const accent = separate(accentSeed, base, 3);

  const white: Rgb = [255, 255, 255];
  const ink: Rgb = [20, 20, 24];
  const dark = contrast(white, base) >= contrast(ink, base);
  return { bg: hex(base), bg2: hex(bg2), accent: hex(accent), text: dark ? "#ffffff" : "#141418", dark };
}

export const DEFAULT_PALETTE: Palette = { bg: "#1d1b26", bg2: "#0e0d14", accent: "#c94fd6", text: "#ffffff", dark: true };
