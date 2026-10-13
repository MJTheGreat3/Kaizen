/**
 * Runs sync in the background while unlocked: shortly after unlocking,
 * after local changes (debounced), when the app comes back to the
 * foreground, and every few minutes. Other devices' changes reload every
 * query and reschedule notifications.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { getPref } from "@/core/db/prefs";
import { syncNotifications } from "@/core/notifications/scheduler";
import { ipc, type SyncReport } from "@/lib/ipc";
import { log } from "@/lib/log";

const AFTER_CHANGE = 15_000;
const EVERY = 5 * 60_000;
const ON_RESUME_AFTER = 60_000;

interface SyncState {
  running: boolean;
  lastAt: number | null;
  lastError: string | null;
}

export const useSyncState = create<SyncState>(() => ({ running: false, lastAt: null, lastError: null }));

let inFlight: Promise<SyncReport | null> | null = null;

/**
 * Syncs through every transport set up on this device. Resolves to the
 * combined report, or null when nothing is set up.
 */
export function syncNow(): Promise<SyncReport | null> {
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<SyncReport | null> {
  const [status, folder, lanHost, lan] = await Promise.all([
    ipc.syncStatus(),
    getPref("sync.folder"),
    getPref("sync.lanHost"),
    ipc.syncLanInfo(),
  ]);
  if (!status.groupId) return null;
  const jobs: Array<() => Promise<SyncReport>> = [];
  // Direct first: it is fastest when the laptop is reachable. The laptop
  // syncs with the folder it serves; the phone with the laptop.
  if (lan.serving) jobs.push(() => ipc.syncLan(null));
  else if (lanHost) jobs.push(() => ipc.syncLan(lanHost));
  if (status.driveAccount !== null) jobs.push(ipc.syncDrive);
  if (folder) jobs.push(() => ipc.syncFolder(folder));
  if (!jobs.length) return null;

  useSyncState.setState({ running: true });
  const total: SyncReport = { sent: 0, received: 0, peers: 0, waiting: false };
  const errors: string[] = [];
  for (const job of jobs) {
    try {
      const r = await job();
      total.sent += r.sent;
      total.received += r.received;
      total.peers = Math.max(total.peers, r.peers);
      total.waiting ||= r.waiting;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  useSyncState.setState({ running: false, lastAt: Date.now(), lastError: errors[0] ?? null });
  if (errors.length === jobs.length) throw new Error(errors[0]);
  return total;
}

export function useAutoSync(enabled: boolean, platform: "android" | "desktop") {
  const client = useQueryClient();

  // Other devices' changes landed: reload everything shown.
  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<number>("sync://changed", () => {
          client.invalidateQueries();
          syncNotifications(platform).catch((e) => log.warn(`notification sync failed: ${String(e)}`));
        }),
      )
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) => log.warn(`sync listener failed: ${String(e)}`));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled, platform, client]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      syncNow()
        .then(() => client.invalidateQueries({ queryKey: ["sync-status"] }))
        .catch((e) => log.warn(`sync failed: ${String(e)}`));
    };
    const soon = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(tick, delay);
    };
    soon(3_000);
    const interval = setInterval(tick, EVERY);
    const unsubscribe = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.mutation.state.status === "success") soon(AFTER_CHANGE);
    });
    const onVisible = () => {
      const last = useSyncState.getState().lastAt ?? 0;
      if (document.visibilityState === "visible" && Date.now() - last > ON_RESUME_AFTER) soon(500);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, client]);
}
