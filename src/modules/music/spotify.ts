/**
 * Spotify Web API through the Rust proxy (`music_api`): Kaizen controls
 * whichever Spotify app is playing (Spotify Connect) and reads the library.
 */
import { ipc } from "@/lib/ipc";

export interface SpotifyImage {
  url: string;
  width: number | null;
  height: number | null;
}

export interface Artist {
  id: string;
  name: string;
}

/** A track or podcast episode. */
export interface PlayItem {
  id: string;
  uri: string;
  kind: "track" | "episode";
  name: string;
  artists: Artist[];
  album: string;
  albumUri: string | null;
  images: SpotifyImage[];
  durationMs: number;
}

export interface Device {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  volume: number | null;
  supportsVolume: boolean;
}

export type Repeat = "off" | "context" | "track";

export interface Playback {
  isPlaying: boolean;
  progressMs: number;
  /** When `progressMs` was true (local clock). */
  at: number;
  item: PlayItem | null;
  device: Device | null;
  shuffle: boolean;
  repeat: Repeat;
  contextUri: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- raw Spotify JSON */
export function toItem(j: any): PlayItem | null {
  if (!j?.id) return null;
  const episode = j.type === "episode";
  return {
    id: j.id,
    uri: j.uri,
    kind: episode ? "episode" : "track",
    name: j.name ?? "",
    artists: episode ? [{ id: j.show?.id ?? "", name: j.show?.name ?? "" }] : (j.artists ?? []).map((a: any) => ({ id: a.id, name: a.name })),
    album: episode ? (j.show?.name ?? "") : (j.album?.name ?? ""),
    albumUri: episode ? (j.show?.uri ?? null) : (j.album?.uri ?? null),
    images: (episode ? (j.images ?? j.show?.images) : j.album?.images) ?? [],
    durationMs: j.duration_ms ?? 0,
  };
}

export function toDevice(d: any): Device {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    isActive: !!d.is_active,
    volume: d.volume_percent ?? null,
    supportsVolume: d.supports_volume !== false && d.volume_percent != null,
  };
}

export function toPlayback(j: any, at = Date.now()): Playback | null {
  if (!j || typeof j !== "object") return null;
  return {
    isPlaying: !!j.is_playing,
    progressMs: j.progress_ms ?? 0,
    at,
    item: toItem(j.item),
    device: j.device ? toDevice(j.device) : null,
    shuffle: !!j.shuffle_state,
    repeat: (j.repeat_state as Repeat) ?? "off",
    contextUri: j.context?.uri ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** The best image at least `px` wide (or the largest). */
export function imageFor(images: SpotifyImage[] | undefined, px: number): string | null {
  if (!images?.length) return null;
  const sorted = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((i) => (i.width ?? 0) >= px) ?? sorted.at(-1))!.url;
}

/** Where the song is now, moving on from the last reading while playing. */
export function positionNow(p: Playback | null | undefined, now = Date.now()): number {
  if (!p) return 0;
  const ms = p.isPlaying ? p.progressMs + (now - p.at) : p.progressMs;
  return Math.min(ms, p.item?.durationMs ?? ms);
}

const q = (params: Record<string, string | number | boolean | undefined>) =>
  Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join("&");

export const spotify = {
  get: <T>(path: string) => ipc.musicApi<T>("GET", path),
  playback: async () => toPlayback(await ipc.musicApi("GET", "/me/player?additional_types=episode")),
  devices: async () => {
    const r = await ipc.musicApi<{ devices: unknown[] }>("GET", "/me/player/devices");
    return (r?.devices ?? []).map(toDevice);
  },
  play: (body?: { context_uri?: string; uris?: string[]; offset?: { uri?: string; position?: number } }, deviceId?: string) =>
    ipc.musicApi("PUT", `/me/player/play${deviceId ? `?${q({ device_id: deviceId })}` : ""}`, body),
  pause: () => ipc.musicApi("PUT", "/me/player/pause"),
  next: () => ipc.musicApi("POST", "/me/player/next"),
  previous: () => ipc.musicApi("POST", "/me/player/previous"),
  seek: (ms: number) => ipc.musicApi("PUT", `/me/player/seek?${q({ position_ms: Math.round(ms) })}`),
  shuffle: (on: boolean) => ipc.musicApi("PUT", `/me/player/shuffle?${q({ state: on })}`),
  repeat: (mode: Repeat) => ipc.musicApi("PUT", `/me/player/repeat?${q({ state: mode })}`),
  volume: (pct: number) => ipc.musicApi("PUT", `/me/player/volume?${q({ volume_percent: Math.round(pct) })}`),
  transfer: (deviceId: string, play: boolean) => ipc.musicApi("PUT", "/me/player", { device_ids: [deviceId], play }),
  queue: (uri: string) => ipc.musicApi("POST", `/me/player/queue?${q({ uri })}`),
  saved: async (ids: string[]) => ipc.musicApi<boolean[]>("GET", `/me/tracks/contains?${q({ ids: ids.join(",") })}`),
  save: (id: string, on: boolean) => ipc.musicApi(on ? "PUT" : "DELETE", `/me/tracks?${q({ ids: id })}`),
  query: q,
};

export const nextRepeat: Record<Repeat, Repeat> = { off: "context", context: "track", track: "off" };
