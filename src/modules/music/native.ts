/**
 * Bridge to the Android audio effects (`plugin:audiofx`): a visualiser fed
 * by what Spotify plays and an equaliser applied to it. Elsewhere these
 * calls do nothing.
 */
import { invoke } from "@tauri-apps/api/core";

let android = false;

export function setAudioFxPlatform(isAndroid: boolean) {
  android = isAndroid;
}

export const audioFxAvailable = () => android;

export interface AudioFxState {
  /** Microphone permission, which the visualiser needs. */
  record: boolean;
  session: number;
  /** Effects follow Spotify's own audio rather than the whole output. */
  spotifySession: boolean;
  /** The equaliser's band centres (Hz). */
  eqBands: number[];
  eqMin: number;
  eqMax: number;
  eqOn: boolean;
  eqError: string | null;
}

const call = <T>(command: string, args?: Record<string, unknown>) => invoke<T>(`plugin:audiofx|${command}`, args);

export const audioFx = {
  state: () => call<AudioFxState>("state"),
  /** Asks for the microphone permission; resolves with whether it was granted. */
  requestRecord: async () => {
    const r = await call<{ record: string }>("request_permissions", { permissions: ["record"] });
    return r.record === "granted";
  },
  visualizerStart: () => call<void>("visualizer_start"),
  visualizerStop: () => call<void>("visualizer_stop"),
  visualizerFrame: () => call<{ bands: number[]; age: number }>("visualizer_frame"),
  eqSet: (enabled: boolean, gains: number[], preset: string) => call<void>("eq_set", { enabled, gains, preset }),
};
