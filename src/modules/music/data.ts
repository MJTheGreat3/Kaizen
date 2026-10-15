import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { desc, gte, isNull, and } from "drizzle-orm";
import { toast } from "sonner";

import { db, schema } from "@/core/db/client";
import { usePref } from "@/core/db/prefs";
import { ipc, type MusicStatus } from "@/lib/ipc";
import { log } from "@/lib/log";
import { DEFAULT_PALETTE, EQ_PRESETS, gainsFor, paletteFrom, type Palette } from "./logic";
import { audioFx, audioFxAvailable } from "./native";
import { imageFor, positionNow, spotify, toItem, type Playback, type PlayItem, type SpotifyImage } from "./spotify";

const PLAYBACK = ["music", "playback"] as const;

export function useMusicStatus() {
  return useQuery({ queryKey: ["music", "status"], queryFn: ipc.musicStatus, staleTime: 60_000 });
}

/** Connected to Spotify on this device. */
export function useConnected() {
  return !!useMusicStatus().data?.connected;
}

export function useConnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ipc.musicConnect,
    onSuccess: (name) => {
      toast.success(name ? `Connected as ${name}` : "Spotify connected");
      client.invalidateQueries({ queryKey: ["music"] });
    },
    onError: (e) => toast.error(`Could not connect: ${String(e)}`),
  });
}

export function useDisconnect() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ipc.musicDisconnect,
    onSuccess: () => {
      client.setQueryData<MusicStatus>(["music", "status"], (s) => (s ? { ...s, connected: false, name: null } : s));
      client.removeQueries({ queryKey: PLAYBACK });
    },
  });
}

/**
 * What is playing, read every `everyMs` while the app is in front. The
 * position moves on locally between readings (`positionNow`).
 */
export function usePlayback(everyMs: number) {
  const connected = useConnected();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: PLAYBACK,
    queryFn: () => spotify.playback(),
    enabled: connected,
    refetchInterval: everyMs,
    staleTime: 500,
    retry: false,
  });
  // Read again right when the song should end, so the next one shows at once.
  const p = query.data;
  useEffect(() => {
    if (!p?.isPlaying || !p.item) return;
    const left = p.item.durationMs - positionNow(p);
    if (left > everyMs) return;
    const timer = setTimeout(() => void client.invalidateQueries({ queryKey: PLAYBACK }), Math.max(300, left + 400));
    return () => clearTimeout(timer);
  }, [p, everyMs, client]);
  return query;
}

function refreshSoon(client: QueryClient, ms = 450) {
  setTimeout(() => void client.invalidateQueries({ queryKey: PLAYBACK }), ms);
}

/**
 * Runs a player command: shows its effect at once (`optimistic`), then reads
 * the real state back.
 */
export function useControl() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ run }: { run: () => Promise<unknown>; optimistic?: (p: Playback) => Playback }) => run(),
    onMutate: ({ optimistic }) => {
      if (!optimistic) return;
      client.setQueryData<Playback | null>(PLAYBACK, (p) => (p ? optimistic({ ...p, progressMs: positionNow(p), at: Date.now() }) : p));
    },
    onSettled: () => refreshSoon(client),
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });
}

export function useDevices(enabled: boolean) {
  return useQuery({ queryKey: ["music", "devices"], queryFn: spotify.devices, enabled, refetchInterval: enabled ? 5000 : false });
}

export function useLyrics(item: PlayItem | null | undefined) {
  return useQuery({
    queryKey: ["music", "lyrics", item?.id],
    queryFn: () => ipc.musicLyrics(item!.name, item!.artists[0]?.name ?? "", item!.album, item!.durationMs),
    enabled: !!item && item.kind === "track",
    staleTime: Infinity,
    retry: 1,
  });
}

/** Whether the track is in Liked Songs; null when Spotify will not say. */
export function useSaved(id: string | undefined) {
  return useQuery({
    queryKey: ["music", "saved", id],
    queryFn: async () => (await spotify.saved([id!]))?.[0] ?? null,
    enabled: !!id,
    staleTime: 60_000,
    retry: false,
  });
}

export function useToggleSaved() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => spotify.save(id, on),
    onMutate: ({ id, on }) => client.setQueryData(["music", "saved", id], on),
    onError: (e, { id }) => {
      toast.error(String(e instanceof Error ? e.message : e));
      client.invalidateQueries({ queryKey: ["music", "saved", id] });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["music", "liked"] }),
  });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface PlaylistSummary {
  id: string;
  uri: string;
  name: string;
  owner: string;
  tracks: number | null;
  images: SpotifyImage[];
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Spotify JSON */
export function usePlaylists(enabled: boolean) {
  return useQuery({
    queryKey: ["music", "playlists"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<PlaylistSummary[]> => {
      const r = await spotify.get<any>("/me/playlists?limit=50");
      return (r?.items ?? [])
        .filter(Boolean)
        .map((p: any) => ({
          id: p.id,
          uri: p.uri,
          name: p.name,
          owner: p.owner?.display_name ?? "",
          tracks: p.tracks?.total ?? p.items?.total ?? null,
          images: p.images ?? [],
        }));
    },
  });
}

export function useLiked(enabled: boolean) {
  return useQuery({
    queryKey: ["music", "liked"],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const r = await spotify.get<any>("/me/tracks?limit=50");
      return { total: (r?.total as number) ?? 0, items: ((r?.items ?? []) as any[]).map((x) => toItem(x.track)).filter((x): x is PlayItem => !!x) };
    },
  });
}

/** A playlist's tracks (Spotify renamed `tracks` to `items` in 2026; both are read). */
export function usePlaylistTracks(id: string | null) {
  return useQuery({
    queryKey: ["music", "playlist", id],
    enabled: !!id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let r: any;
      try {
        r = await spotify.get<any>(`/playlists/${id}/items?limit=100`);
      } catch {
        r = await spotify.get<any>(`/playlists/${id}/tracks?limit=100`);
      }
      return ((r?.items ?? []) as any[]).map((x) => toItem(x.item ?? x.track)).filter((x): x is PlayItem => !!x);
    },
  });
}

export type TopRange = "short_term" | "medium_term" | "long_term";

export interface TopArtist {
  id: string;
  uri: string;
  name: string;
  images: SpotifyImage[];
  genres: string[];
}

export function useTop(range: TopRange, enabled: boolean) {
  return useQuery({
    queryKey: ["music", "top", range],
    enabled,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const [artists, tracks] = await Promise.all([
        spotify.get<any>(`/me/top/artists?time_range=${range}&limit=20`),
        spotify.get<any>(`/me/top/tracks?time_range=${range}&limit=20`),
      ]);
      return {
        artists: ((artists?.items ?? []) as any[]).map((a) => ({ id: a.id, uri: a.uri, name: a.name, images: a.images ?? [], genres: a.genres ?? [] })) as TopArtist[],
        tracks: ((tracks?.items ?? []) as any[]).map(toItem).filter((x): x is PlayItem => !!x),
      };
    },
  });
}

export interface SearchResults {
  tracks: PlayItem[];
  artists: TopArtist[];
  albums: { id: string; uri: string; name: string; artist: string; images: SpotifyImage[] }[];
  playlists: PlaylistSummary[];
}

export function useMusicSearch(text: string) {
  return useQuery({
    queryKey: ["music", "search", text],
    enabled: text.trim().length >= 2,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<SearchResults> => {
      const r = await spotify.get<any>(`/search?${spotify.query({ q: text.trim(), type: "track,artist,album,playlist", limit: 10 })}`);
      return {
        tracks: ((r?.tracks?.items ?? []) as any[]).map(toItem).filter((x): x is PlayItem => !!x),
        artists: ((r?.artists?.items ?? []) as any[]).filter(Boolean).map((a) => ({ id: a.id, uri: a.uri, name: a.name, images: a.images ?? [], genres: a.genres ?? [] })),
        albums: ((r?.albums?.items ?? []) as any[]).filter(Boolean).map((a) => ({ id: a.id, uri: a.uri, name: a.name, artist: a.artists?.[0]?.name ?? "", images: a.images ?? [] })),
        playlists: ((r?.playlists?.items ?? []) as any[]).filter(Boolean).map((p) => ({ id: p.id, uri: p.uri, name: p.name, owner: p.owner?.display_name ?? "", tracks: null, images: p.images ?? [] })),
      };
    },
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Listening history (local)
// ---------------------------------------------------------------------------

const mp = schema.musicPlays;

/** Plays since `from` (ms), newest first. */
export function useHistory(from: number) {
  return useQuery({
    queryKey: ["music", "history", from],
    queryFn: () => db.select().from(mp).where(and(isNull(mp.deletedAt), gte(mp.playedAt, from))).orderBy(desc(mp.playedAt)),
  });
}

const HISTORY_EVERY_MS = 30 * 60_000;

/** Keeps the local history filled while the app runs (on open, then every half hour). */
export function useHistorySync(connected: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!connected) return;
    const run = () =>
      ipc
        .musicHistorySync()
        .then((added) => {
          if (added) void client.invalidateQueries({ queryKey: ["music", "history"] });
        })
        .catch((e) => log.warn(`listening history sync failed: ${String(e)}`));
    const first = setTimeout(run, 8_000);
    const timer = setInterval(run, HISTORY_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [connected, client]);
}

// ---------------------------------------------------------------------------
// Colours and equaliser
// ---------------------------------------------------------------------------

async function loadPalette(url: string): Promise<Palette> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.src = url;
  await img.decode();
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  return paletteFrom(ctx.getImageData(0, 0, size, size).data);
}

/** Colours taken from the cover; the default palette until it loads. */
export function usePalette(images: SpotifyImage[] | undefined): Palette {
  const url = imageFor(images, 64);
  const { data } = useQuery({
    queryKey: ["music", "palette", url],
    queryFn: () => loadPalette(url!),
    enabled: !!url,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    placeholderData: (prev) => prev,
  });
  return data ?? DEFAULT_PALETTE;
}

export function useAudioFxState(enabled: boolean) {
  return useQuery({ queryKey: ["music", "audiofx"], queryFn: audioFx.state, enabled: enabled && audioFxAvailable(), staleTime: 10_000 });
}

/** The gains a saved equaliser setting means for this phone's bands. */
export function eqGains(eq: { preset: string; custom: number[] }, bands: number[], min: number, max: number): number[] {
  if (eq.preset === "custom" && eq.custom.length === bands.length) return eq.custom;
  const preset = EQ_PRESETS.find((p) => p.id === eq.preset) ?? EQ_PRESETS[0];
  return gainsFor(preset.gains, bands, min, max);
}

export function presetName(id: string) {
  return id === "custom" ? "Custom" : (EQ_PRESETS.find((p) => p.id === id)?.name ?? "Flat");
}

/** Puts the saved equaliser back on after the app starts (Android). */
export function useRestoreEq() {
  const [eq, , loading] = usePref("music.eq");
  useEffect(() => {
    if (loading || !eq.on || !audioFxAvailable()) return;
    audioFx
      .state()
      .then((s) => audioFx.eqSet(true, eqGains(eq, s.eqBands, s.eqMin, s.eqMax), presetName(eq.preset)))
      .catch((e) => log.warn(`equaliser restore failed: ${String(e)}`));
    // Only once per start; later changes are applied where they are made.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);
}

/** Spotify's device types, best first for starting playback from Kaizen on this platform. */
function pickDevice(devices: { id: string; type: string; isActive: boolean }[], android: boolean) {
  const rank = (t: string) => (t === (android ? "Smartphone" : "Computer") ? 0 : t === "Computer" || t === "Smartphone" ? 1 : 2);
  return [...devices].sort((a, b) => Number(b.isActive) - Number(a.isActive) || rank(a.type) - rank(b.type))[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until Kaizen is in front again (or `ms` passes). */
async function untilVisible(ms: number) {
  const until = Date.now() + ms;
  while (document.visibilityState !== "visible" && Date.now() < until) await sleep(250);
  await sleep(500);
}

async function waitForDevice(ms: number, android: boolean) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await sleep(1000);
    const device = pickDevice(await spotify.devices().catch(() => []), android);
    if (device) return device;
  }
  return null;
}

/**
 * Plays, starting Spotify first when no device is active: an open Spotify
 * app is used at once; otherwise Kaizen starts Spotify without showing it
 * (hidden on the laptop, a play button press on the phone), and on the
 * phone opens it briefly if that was not enough, then comes back.
 */
export async function playWithWake(body?: Parameters<typeof spotify.play>[0]) {
  try {
    await spotify.play(body);
    return;
  } catch (e) {
    if (!String(e).includes("No Spotify device")) throw e;
  }
  const android = audioFxAvailable();
  let device: { id: string } | null | undefined = pickDevice(await spotify.devices(), android);
  if (!device) {
    const toastId = toast.loading("Starting Spotify…");
    try {
      if (!(await ipc.musicWake("background"))) throw new Error("Spotify is not installed on this device.");
      device = await waitForDevice(android ? 6000 : 12000, android);
      if (!device && android) {
        // Spotify needs a moment in front to start; Kaizen has no network
        // in the background, so it comes back before looking again.
        await ipc.musicWake("foreground");
        await sleep(4000);
        await ipc.intakeTake(true).catch(() => []);
        await untilVisible(8000);
        device = await waitForDevice(12000, android);
      }
    } finally {
      toast.dismiss(toastId);
    }
  }
  if (!device) throw new Error("Spotify did not come online. Open it once and try again.");
  await spotify.play(body, device.id);
}

/** Starts playback, waking Spotify when needed. */
export function usePlay() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof spotify.play>[0]) => playWithWake(body),
    onSettled: () => refreshSoon(client, 700),
    onError: (e) => toast.error(String(e instanceof Error ? e.message : e)),
  });
}
