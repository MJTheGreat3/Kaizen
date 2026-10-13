/**
 * Keeps the active session honest: completes it when time is up, applies
 * what the Android service recorded while Kaizen was in the background, and
 * runs desktop strict mode (leaving the window for longer than the grace
 * period withers the tree).
 */
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { getPref } from "@/core/db/prefs";
import { log } from "@/lib/log";
import { finishSession, loadFocus, pauseSession, resumeSession } from "./data";
import { endsAt, speciesFor } from "./logic";
import { focusNative } from "./native";

/** Current time, ticking every `ms` while `enabled`. */
export function useNow(enabled: boolean, ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [enabled, ms]);
  return now;
}

async function notify(title: string, body: string) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    if ((await n.isPermissionGranted()) === true) n.sendNotification({ title, body });
  } catch {
    // Notifications are a nicety here.
  }
}

/** Applies events the Android service recorded, oldest first. */
async function applyNativeEvents() {
  const events = await focusNative.drainEvents();
  if (!events.length) return false;
  for (const event of events.sort((a, b) => a.at - b.at)) {
    const { active } = await loadFocus();
    if (!active) break;
    // Leftovers from an earlier session do not apply to this one.
    if (event.sessionId && event.sessionId !== active.id) continue;
    if (event.type === "pause") await pauseSession(active, event.at);
    else if (event.type === "resume") await resumeSession(active, event.at);
    else if (event.type === "give_up") await finishSession(active, "given_up", event.at);
    else if (event.type === "withered") await finishSession(active, "withered", event.at);
    else if (event.type === "completed") await finishSession(active, "completed", event.at);
  }
  return true;
}

export interface Away {
  /** When the tree withers unless the user comes back. */
  deadline: number;
}

/** Desktop strict mode: set while the window is out of focus. */
export const useFocusAway = create<{ away: Away | null }>(() => ({ away: null }));
const setAway = (away: Away | null) => useFocusAway.setState({ away });

/**
 * Mounted once for the whole app while unlocked, so sessions complete and
 * strict mode works on any screen.
 */
export function useFocusEngine(enabled: boolean, platform: "android" | "desktop") {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["focus"] });
  const { data } = useQuery({ queryKey: ["focus"], queryFn: loadFocus, enabled });
  const active = enabled ? (data?.active ?? null) : null;
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Android: catch up with the service on open and whenever we come back.
  useEffect(() => {
    if (platform !== "android" || !enabled) return;
    const sync = () =>
      applyNativeEvents()
        .then((changed) => {
          if (changed) refresh();
        })
        .catch((e) => log.warn(`focus events failed: ${String(e)}`));
    sync();
    const onVisible = () => document.visibilityState === "visible" && sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, enabled]);

  // Complete on time, even if the timer screen was not open at that moment.
  useEffect(() => {
    if (!active || active.status !== "running") return;
    const due = endsAt(active, Date.now());
    const timer = setTimeout(
      async () => {
        const current = activeRef.current;
        if (!current || current.id !== active.id || current.status !== "running") return;
        await finishSession(current, "completed", Math.min(Date.now(), endsAt(current, Date.now())));
        await focusNative.stop();
        if (platform === "desktop") {
          notify(`${speciesFor(current.species).name} grown`, `${current.plannedMinutes} minutes of focus. Time for a break.`);
        }
        refresh();
      },
      Math.max(0, due - Date.now()),
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.status, active?.pausedMs, active?.startedAt, active?.plannedMinutes, platform]);

  // Desktop strict mode: watch the window's focus.
  useEffect(() => {
    if (platform !== "desktop" || !active?.strict || active.status !== "running") {
      setAway(null);
      return;
    }
    let unlisten: (() => void) | undefined;
    let witherTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    (async () => {
      const grace = (await getPref("focus.grace")) * 1000;
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const fn = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        clearTimeout(witherTimer);
        if (focused) {
          setAway(null);
          return;
        }
        const deadline = Date.now() + grace;
        setAway({ deadline });
        notify("Come back to Kaizen", `Your tree withers in ${Math.round(grace / 1000)} seconds.`);
        witherTimer = setTimeout(async () => {
          const current = activeRef.current;
          if (!current || current.status !== "running") return;
          await finishSession(current, "withered", deadline);
          setAway(null);
          refresh();
        }, grace);
      });
      if (cancelled) fn();
      else unlisten = fn;
    })().catch((e) => log.warn(`strict mode failed: ${String(e)}`));
    return () => {
      cancelled = true;
      clearTimeout(witherTimer);
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, active?.id, active?.status, active?.strict]);
}
