import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { buildWidgetFeed } from "./widgetFeed";
import { log } from "@/lib/log";

const SETTLE_MS = 1500;

const WIDGET_DATA = ["tasks", "habits", "today", "goals"];

/**
 * Keeps the phone's home-screen widgets and the Mac's desktop widgets in
 * step: after changes made in the app (debounced), on opening, and when
 * leaving the app (which also covers changes synced in from another device).
 */
export function useWidgetSync(platform: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (platform !== "android" && platform !== "macos") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () =>
      buildWidgetFeed()
        .then((feed) => ipc.widgetRefresh(feed))
        .catch((e) => log.warn(`widget refresh failed: ${String(e)}`));
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, SETTLE_MS);
    };
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") soon();
    });
    const onHide = () => {
      if (document.visibilityState === "hidden") void refresh();
      // Back from the home screen: ticks made on the widget show here too.
      else for (const key of WIDGET_DATA) void client.invalidateQueries({ queryKey: [key] });
    };
    document.addEventListener("visibilitychange", onHide);
    // The Mac applies widget taps itself, then says so.
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    if (platform === "macos") {
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen("widget://changed", () => {
          for (const key of WIDGET_DATA) void client.invalidateQueries({ queryKey: [key] });
          soon();
        }).then((fn) => {
          if (cancelled) fn();
          else unlisten = fn;
        }),
      );
    }
    // Hourly too, so the widgets' goals and streaks follow the day.
    const hourly = setInterval(refresh, 3_600_000);
    soon();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(hourly);
      unsubscribe();
      unlisten?.();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [platform, client]);
}
