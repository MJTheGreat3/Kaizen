import { useMemo, useState } from "react";

import { addDaysKey, todayKey } from "@/lib/dates";
import { useHistory, usePlay, useTop, type TopRange } from "./data";
import { Cover, Tabs } from "./Library";
import type { Palette } from "./logic";

const RANGES: { value: TopRange; label: string }[] = [
  { value: "short_term", label: "4 weeks" },
  { value: "medium_term", label: "6 months" },
  { value: "long_term", label: "A year" },
];

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl bg-current/[0.07] p-4">
      <p className="text-[12px] font-medium opacity-65">{label}</p>
      <p className="mt-1 truncate text-[22px] font-bold leading-none tabular-nums">{value}</p>
      {sub ? <p className="mt-1 truncate text-[12px] opacity-60">{sub}</p> : null}
    </div>
  );
}

/** Spotify's top artists and songs, and what Kaizen's own history adds. */
export function Stats({ palette }: { palette: Palette }) {
  const [range, setRange] = useState<TopRange>("short_term");
  const top = useTop(range, true);
  const play = usePlay();
  const [from] = useState(() => Date.now() - 30 * 86_400_000);
  const { data: plays } = useHistory(from);

  const local = useMemo(() => {
    const list = plays ?? [];
    const today = todayKey();
    const days = Array.from({ length: 14 }, (_, i) => addDaysKey(today, i - 13));
    const minutes = new Map<string, number>();
    const artists = new Map<string, number>();
    const tracks = new Map<string, { n: number; title: string; artist: string }>();
    for (const p of list) {
      const k = dayKey(p.playedAt);
      minutes.set(k, (minutes.get(k) ?? 0) + p.durationMs / 60_000);
      for (const a of p.artists) artists.set(a, (artists.get(a) ?? 0) + 1);
      const t = tracks.get(p.trackId) ?? { n: 0, title: p.title, artist: p.artists[0] ?? "" };
      tracks.set(p.trackId, { ...t, n: t.n + 1 });
    }
    const week = days.slice(-7).reduce((s, d) => s + (minutes.get(d) ?? 0), 0);
    const month = [...minutes.values()].reduce((a, b) => a + b, 0);
    return {
      bars: days.map((d) => ({ day: d, minutes: Math.round(minutes.get(d) ?? 0) })),
      week: Math.round(week),
      month: Math.round(month),
      topArtist: [...artists].sort((a, b) => b[1] - a[1])[0],
      topTrack: [...tracks.values()].sort((a, b) => b.n - a.n)[0],
      count: list.length,
    };
  }, [plays]);
  const max = Math.max(1, ...local.bars.map((b) => b.minutes));

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="This week" value={`${local.week} min`} sub="Listened, from Kaizen's history" />
        <Tile label="Last 30 days" value={`${local.month} min`} sub={`${local.count} plays`} />
        <Tile label="Most played artist" value={local.topArtist?.[0] ?? "–"} sub={local.topArtist ? `${local.topArtist[1]} plays in 30 days` : undefined} />
        <Tile label="Most played song" value={local.topTrack?.title ?? "–"} sub={local.topTrack ? `${local.topTrack.artist} · ${local.topTrack.n} plays` : undefined} />
      </div>

      <section className="rounded-2xl bg-current/[0.05] p-4">
        <h3 className="mb-3 text-[14px] font-semibold">Minutes a day, last two weeks</h3>
        <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Listening minutes per day">
          {local.bars.map((b) => (
            <div key={b.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${b.day}: ${b.minutes} min`}>
              <div className="rounded-t-md transition-[height]" style={{ height: `${(b.minutes / max) * 100}%`, minHeight: b.minutes ? 3 : 1, background: b.minutes ? palette.accent : "currentColor", opacity: b.minutes ? 0.9 : 0.15 }} />
              <span className="mt-1 text-center text-[10px] opacity-55">{new Date(`${b.day}T12:00:00`).toLocaleDateString([], { weekday: "narrow" })}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] opacity-55">Counted from songs Kaizen has seen in Spotify's recently played, which only lists the last 50.</p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[16px] font-bold">Your top on Spotify</h3>
        <Tabs value={range} onChange={setRange} options={RANGES} />
      </div>
      {top.isError ? <p className="opacity-70">{String(top.error)}</p> : null}
      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h4 className="mb-2 text-[13px] font-semibold opacity-65">Artists</h4>
          <ol className="grid gap-1">
            {(top.data?.artists ?? []).slice(0, 10).map((a, i) => (
              <li key={a.id}>
                <button type="button" onClick={() => play.mutate({ context_uri: a.uri })} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-current/[0.07]">
                  <span className="w-5 text-right text-[13px] font-bold tabular-nums opacity-55">{i + 1}</span>
                  <Cover images={a.images} size={40} round />
                  <span className="grid min-w-0">
                    <span className="truncate text-[14px] font-semibold">{a.name}</span>
                    <span className="truncate text-[12px] opacity-60">{a.genres.slice(0, 2).join(", ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h4 className="mb-2 text-[13px] font-semibold opacity-65">Songs</h4>
          <ol className="grid gap-1">
            {(top.data?.tracks ?? []).slice(0, 10).map((t, i) => (
              <li key={t.id}>
                <button type="button" onClick={() => play.mutate({ uris: [t.uri] })} className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-current/[0.07]">
                  <span className="w-5 text-right text-[13px] font-bold tabular-nums opacity-55">{i + 1}</span>
                  <Cover images={t.images} size={40} />
                  <span className="grid min-w-0">
                    <span className="truncate text-[14px] font-semibold">{t.name}</span>
                    <span className="truncate text-[12px] opacity-60">{t.artists.map((a) => a.name).join(", ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
