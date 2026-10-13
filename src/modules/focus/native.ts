/**
 * Bridge to the Android focus service (`plugin:focus`): an ongoing
 * countdown notification with Pause / Give up, strict mode (leaving for a
 * distracting app withers the tree) and Do Not Disturb. The service keeps
 * working while Kaizen is closed and records what happened as events, which
 * the app applies to the session when it is next opened. On desktop every
 * call is a no-op.
 */
import { invoke } from "@tauri-apps/api/core";

import { log } from "@/lib/log";

export type NativeEventType = "pause" | "resume" | "give_up" | "withered" | "completed";

export interface NativeEvent {
  type: NativeEventType;
  /** Epoch milliseconds. */
  at: number;
  sessionId: string;
}

export interface NativePermissions {
  /** Usage access, needed for strict mode. */
  usage: boolean;
  /** Do Not Disturb access. */
  dnd: boolean;
}

export interface StartOptions {
  sessionId: string;
  title: string;
  /** When the session ends, if not paused. */
  endsAt: number;
  strict: boolean;
  dnd: boolean;
  graceSeconds: number;
}

let isAndroid = false;

export function setNativePlatform(android: boolean) {
  isAndroid = android;
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isAndroid) return null;
  try {
    return await invoke<T>(`plugin:focus|${command}`, args);
  } catch (e) {
    log.warn(`focus service ${command} failed: ${String(e)}`);
    return null;
  }
}

export const focusNative = {
  start: (options: StartOptions) => call<void>("start", { ...options }),
  /** Paused: the notification shows the time left and a Resume button. */
  pause: (remainingMs: number) => call<void>("pause", { remainingMs }),
  resume: (endsAt: number) => call<void>("resume", { endsAt }),
  stop: () => call<void>("stop"),
  /** Takes the events recorded since the last call. */
  drainEvents: async () => (await call<{ events: NativeEvent[] }>("drain_events"))?.events ?? [],
  permissions: () => call<NativePermissions>("access"),
  openUsageSettings: () => call<void>("open_usage_settings"),
  openDndSettings: () => call<void>("open_dnd_settings"),
};
