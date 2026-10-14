import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Heart, MagnifyingGlass, MusicNotes, Play, Queue } from "@phosphor-icons/react";
import { toast } from "sonner";

import { formatLongDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useHistory, useLiked, useMusicSearch, usePlay, usePlaylists, usePlaylistTracks, type PlaylistSummary } from "./data";
import { clock } from "./logic";
import { imageFor, spotify, type PlayItem, type SpotifyImage } from "./spotify";

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-9 shrink-0 rounded-full px-4 text-[14px] font-semibold transition-colors", value === o.value ? "bg-current/15" : "opacity-65 hover:opacity-100")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Cover({ images, size, round, className }: { images: SpotifyImage[]; size: number; round?: boolean; className?: string }) {
  const url = imageFor(images, size * 2);
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden bg-current/10", round ? "rounded-full" : "rounded-lg", className)} style={{ width: size, height: size }}>
      {url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" /> : <MusicNotes size={size * 0.4} className="opacity-50" />}
    </span>
  );
}

function TrackRow({ item, onPlay, detail }: { item: PlayItem; onPlay: () => void; detail?: ReactNode }) {
  return (
    <li className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-current/[0.07]">
      <button type="button" onClick={onPlay} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Cover images={item.images} size={42} />
        <span className="grid min-w-0">
          <span className="truncate text-[14px] font-semibold">{item.name}</span>
          <span className="truncate text-[12px] opacity-65">{item.artists.map((a) => a.name).join(", ")}</span>
        </span>
      </button>
      <span className="shrink-0 text-[12px] tabular-nums opacity-55">{detail ?? clock(item.durationMs)}</span>
      <button
        type="button"
        aria-label={`Add ${item.name} to the queue`}
        onClick={() =>
          spotify
            .queue(item.uri)
            .then(() => toast.success(`Queued ${item.name}`))
            .catch((e) => toast.error(String(e instanceof Error ? e.message : e)))
        }
        className="grid size-8 shrink-0 place-items-center rounded-full opacity-60 hover:bg-current/10 hover:opacity-100"
      >
        <Queue size={17} />
      </button>
    </li>
  );
}

function Playlist({ playlist, onBack }: { playlist: PlaylistSummary; onBack: () => void }) {
  const { data, isLoading, isError } = usePlaylistTracks(playlist.id);
  const play = usePlay();
  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-4">
        <button type="button" onClick={onBack} aria-label="Back to playlists" className="grid size-9 place-items-center rounded-full hover:bg-current/10">
          <ArrowLeft size={18} />
        </button>
        <Cover images={playlist.images} size={64} />
        <div className="grid min-w-0 flex-1">
          <span className="truncate text-[18px] font-bold">{playlist.name}</span>
          <span className="truncate text-[13px] opacity-65">{playlist.owner}</span>
        </div>
        <button type="button" onClick={() => play.mutate({ context_uri: playlist.uri })} className="flex h-10 items-center gap-2 rounded-full bg-current/15 px-4 text-[14px] font-semibold">
          <Play size={16} weight="fill" />
          Play
        </button>
      </div>
      {isLoading ? <p className="opacity-60">Loading…</p> : null}
      {isError ? <p className="opacity-70">Spotify did not share this playlist's songs (playlists you neither own nor follow are hidden from apps in development mode).</p> : null}
      <ul className="grid">
        {(data ?? []).map((t, i) => (
          <TrackRow key={`${t.id}-${i}`} item={t} onPlay={() => play.mutate({ context_uri: playlist.uri, offset: { uri: t.uri } })} />
        ))}
      </ul>
    </div>
  );
}

function Playlists() {
  const { data, isLoading } = usePlaylists(true);
  const liked = useLiked(true);
  const play = usePlay();
  const [open, setOpen] = useState<PlaylistSummary | null>(null);
  const [likedOpen, setLikedOpen] = useState(false);
  if (open) return <Playlist playlist={open} onBack={() => setOpen(null)} />;
  if (likedOpen) {
    const uris = liked.data?.items.map((t) => t.uri) ?? [];
    return (
      <div className="grid gap-4">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => setLikedOpen(false)} aria-label="Back to playlists" className="grid size-9 place-items-center rounded-full hover:bg-current/10">
            <ArrowLeft size={18} />
          </button>
          <span className="grid size-16 place-items-center rounded-lg bg-gradient-to-br from-indigo-500 to-sky-300 text-white">
            <Heart size={26} weight="fill" />
          </span>
          <div className="grid flex-1">
            <span className="text-[18px] font-bold">Liked Songs</span>
            <span className="text-[13px] opacity-65">{liked.data?.total ?? 0} songs · latest 50 here</span>
          </div>
        </div>
        <ul className="grid">
          {(liked.data?.items ?? []).map((t) => (
            <TrackRow key={t.id} item={t} onPlay={() => play.mutate({ uris, offset: { uri: t.uri } })} />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <button type="button" onClick={() => setLikedOpen(true)} className="grid gap-2 rounded-2xl bg-current/[0.06] p-3 text-left transition-colors hover:bg-current/10">
        <span className="grid aspect-square w-full place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-sky-300 text-white">
          <Heart size={36} weight="fill" />
        </span>
        <span className="grid">
          <span className="truncate text-[14px] font-semibold">Liked Songs</span>
          <span className="truncate text-[12px] opacity-60">{liked.data ? `${liked.data.total} songs` : " "}</span>
        </span>
      </button>
      {(data ?? []).map((p) => (
        <button key={p.id} type="button" onClick={() => setOpen(p)} className="grid gap-2 rounded-2xl bg-current/[0.06] p-3 text-left transition-colors hover:bg-current/10">
          <span className="block aspect-square w-full overflow-hidden rounded-xl bg-current/10">
            {imageFor(p.images, 300) ? <img src={imageFor(p.images, 300)!} alt="" loading="lazy" className="size-full object-cover" /> : null}
          </span>
          <span className="grid">
            <span className="truncate text-[14px] font-semibold">{p.name}</span>
            <span className="truncate text-[12px] opacity-60">{p.tracks != null ? `${p.tracks} songs` : p.owner}</span>
          </span>
        </button>
      ))}
      {isLoading ? <p className="col-span-full opacity-60">Loading playlists…</p> : null}
    </div>
  );
}

function History() {
  const [from] = useState(() => Date.now() - 7 * 86_400_000);
  const { data } = useHistory(from);
  const play = usePlay();
  const days = useMemo(() => {
    const out = new Map<string, NonNullable<typeof data>>();
    for (const p of data ?? []) {
      const d = new Date(p.playedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      out.set(key, [...(out.get(key) ?? []), p]);
    }
    return [...out];
  }, [data]);
  if (!data?.length) return <p className="py-6 opacity-65">Songs you play show here. Kaizen reads Spotify's recently played every half hour while it runs and keeps them, so your history grows past Spotify's last 50.</p>;
  return (
    <div className="grid gap-5">
      {days.map(([day, plays]) => (
        <section key={day}>
          <h3 className="mb-1 px-2 text-[13px] font-semibold opacity-60">{formatLongDate(day)}</h3>
          <ul className="grid">
            {plays.map((p) => (
              <TrackRow
                key={p.id}
                item={{ id: p.trackId, uri: `spotify:track:${p.trackId}`, kind: "track", name: p.title, artists: p.artists.map((name) => ({ id: "", name })), album: p.album, albumUri: null, images: p.image ? [{ url: p.image, width: 300, height: 300 }] : [], durationMs: p.durationMs }}
                onPlay={() => play.mutate({ uris: [`spotify:track:${p.trackId}`] })}
                detail={new Date(p.playedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Search() {
  const [text, setText] = useState("");
  const deferred = useDeferredValue(text);
  const { data, isFetching } = useMusicSearch(deferred);
  const play = usePlay();
  return (
    <div className="grid gap-5">
      <label className="flex h-11 items-center gap-2.5 rounded-xl bg-current/[0.08] px-3">
        <MagnifyingGlass size={17} className="opacity-60" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Songs, artists, albums, playlists" className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-current/50" autoFocus />
      </label>
      {isFetching && !data ? <p className="opacity-60">Searching…</p> : null}
      {data ? (
        <>
          {data.tracks.length ? (
            <section>
              <h3 className="mb-1 px-2 text-[13px] font-semibold opacity-60">Songs</h3>
              <ul className="grid">
                {data.tracks.map((t) => (
                  <TrackRow key={t.id} item={t} onPlay={() => play.mutate({ uris: [t.uri] })} />
                ))}
              </ul>
            </section>
          ) : null}
          {[
            { title: "Artists", list: data.artists.map((a) => ({ key: a.id, name: a.name, sub: a.genres.slice(0, 2).join(", "), images: a.images, round: true, uri: a.uri })) },
            { title: "Albums", list: data.albums.map((a) => ({ key: a.id, name: a.name, sub: a.artist, images: a.images, round: false, uri: a.uri })) },
            { title: "Playlists", list: data.playlists.map((p) => ({ key: p.id, name: p.name, sub: p.owner, images: p.images, round: false, uri: p.uri })) },
          ]
            .filter((g) => g.list.length)
            .map((g) => (
              <section key={g.title}>
                <h3 className="mb-2 px-2 text-[13px] font-semibold opacity-60">{g.title}</h3>
                <div className="flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none]">
                  {g.list.map((x) => (
                    <button key={x.key} type="button" onClick={() => play.mutate({ context_uri: x.uri })} className="grid w-28 shrink-0 justify-items-center gap-1.5 rounded-xl p-2 text-center hover:bg-current/[0.07]">
                      <Cover images={x.images} size={96} round={x.round} />
                      <span className="w-full truncate text-[13px] font-semibold">{x.name}</span>
                      <span className="w-full truncate text-[11px] opacity-60">{x.sub}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
        </>
      ) : null}
    </div>
  );
}

export function Library() {
  const [tab, setTab] = useState<"playlists" | "history" | "search">("playlists");
  return (
    <div className="grid gap-4">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: "playlists", label: "Playlists" },
          { value: "history", label: "History" },
          { value: "search", label: "Search" },
        ]}
      />
      {tab === "playlists" ? <Playlists /> : tab === "history" ? <History /> : <Search />}
    </div>
  );
}
