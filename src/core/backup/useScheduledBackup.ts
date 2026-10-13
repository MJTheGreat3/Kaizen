import { useEffect } from "react";

import { getPref, setPref } from "@/core/db/prefs";
import { ipc } from "@/lib/ipc";
import { log } from "@/lib/log";

const DAY = 24 * 60 * 60 * 1000;
const CHECK_EVERY = 30 * 60 * 1000;

/** Creates a backup in the configured folder and applies retention. */
export async function runBackupNow() {
  const [dir, keep] = await Promise.all([getPref("backup.dir"), getPref("backup.keep")]);
  const backup = await ipc.backupCreate(dir);
  await setPref("backup.lastAt", backup.createdAt);
  const removed = await ipc.backupPrune(dir, keep);
  log.info(`backup saved to ${backup.path}; pruned ${removed}`);
  return backup;
}

async function backupIfDue() {
  const [frequency, lastAt] = await Promise.all([getPref("backup.frequency"), getPref("backup.lastAt")]);
  if (frequency === "off") return;
  const interval = frequency === "daily" ? DAY : 7 * DAY;
  if (Date.now() - lastAt < interval) return;
  await runBackupNow();
}

/** While unlocked, backs up on schedule (checked on unlock and every 30 min). */
export function useScheduledBackup(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => backupIfDue().catch((e) => log.warn(`scheduled backup failed: ${String(e)}`));
    const first = setTimeout(tick, 5_000);
    const timer = setInterval(tick, CHECK_EVERY);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled]);
}
