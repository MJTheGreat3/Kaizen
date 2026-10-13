import { useEffect, useRef } from "react";

import { getPref } from "@/core/db/prefs";
import { useSession } from "./session";

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * Locks after the configured minutes without interaction. Time spent with the
 * app hidden (minimised, phone screen off) counts as inactive.
 */
export function useAutoLock(enabled: boolean) {
  const lock = useSession((s) => s.lock);
  const lastActive = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let timeoutMs = 0;
    let cancelled = false;
    getPref("lock.timeoutMinutes").then((m) => {
      if (!cancelled) timeoutMs = m * 60_000;
    });

    const touch = () => {
      lastActive.current = Date.now();
    };
    const check = () => {
      if (timeoutMs > 0 && Date.now() - lastActive.current >= timeoutMs) void lock();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };
    const onPrefChange = (e: Event) => {
      timeoutMs = (e as CustomEvent<number>).detail * 60_000;
    };

    touch();
    EVENTS.forEach((ev) => window.addEventListener(ev, touch, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("kaizen:lock-timeout", onPrefChange);
    const timer = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      EVENTS.forEach((ev) => window.removeEventListener(ev, touch));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("kaizen:lock-timeout", onPrefChange);
      clearInterval(timer);
    };
  }, [enabled, lock]);
}
