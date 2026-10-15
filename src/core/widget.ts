import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

const SETTLE_MS = 1500;

/**
 * Keeps the phone's home-screen widget in step: after changes made in the
 * app (debounced), on opening, and when leaving the app (which also covers
 * changes synced in from the laptop).
 */
export function useWidgetSync(platform: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (platform !== "android") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => ipc.widgetRefresh().catch((e) => log.warn(`widget refresh failed: ${String(e)}`));
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
      else for (const key of ["tasks", "habits", "today"]) void client.invalidateQueries({ queryKey: [key] });
    };
    document.addEventListener("visibilitychange", onHide);
    soon();
    return () => {
      clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [platform, client]);
}
