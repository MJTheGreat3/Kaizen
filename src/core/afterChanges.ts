import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { log } from "@/lib/log";

/**
 * Runs `check` shortly after unlocking and again after each successful
 * change (debounced), for work that follows from data written anywhere:
 * streak milestones, goals reaching their target.
 */
export function useAfterChanges(enabled: boolean, name: string, check: () => Promise<void>) {
  const client = useQueryClient();
  const latest = useRef(check);
  useEffect(() => {
    latest.current = check;
  });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current().catch((e) => log.warn(`${name} failed: ${String(e)}`)), 2_500);
    };
    soon();
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") soon();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled, name, client]);
}

/** A system notification if allowed; the in-app toast covers the rest. */
export async function notify(title: string, body: string) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    if ((await n.isPermissionGranted()) === true) n.sendNotification({ title, body });
  } catch {
    // The toast is enough.
  }
}
