/**
 * "Sync now" from anywhere: a floating button on desktop, an icon in the
 * phone's top bar. Spins while any sync runs (manual or automatic) and shows
 * a red dot when the last one failed.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ArrowsClockwise } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { syncNow, useSyncState } from "./autosync";

function useSyncAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: syncNow,
    onSuccess: (report) => {
      if (!report) toast("Sync isn't set up yet", { description: "Pair your devices in Settings → Sync." });
      else if (report.received || report.sent) toast.success(`Synced: sent ${report.sent}, received ${report.received}`);
      else toast.success(report.peers ? "Already up to date" : "Uploaded. Waiting for your other device.");
    },
    onError: (e) => toast.error(`Sync failed: ${e instanceof Error ? e.message : String(e)}`),
    onSettled: () => client.invalidateQueries({ queryKey: ["sync-status"] }),
  });
}

export function SyncButton({ variant }: { variant: "floating" | "icon" }) {
  const sync = useSyncAction();
  const running = useSyncState((s) => s.running) || sync.isPending;
  const failed = useSyncState((s) => s.lastError) !== null && !running;

  const icon = (
    <motion.span
      animate={running ? { rotate: 360 } : { rotate: 0 }}
      transition={running ? { duration: 1, repeat: Infinity, ease: "linear" } : { duration: 0.3 }}
      className="grid"
    >
      <ArrowsClockwise size={variant === "floating" ? 22 : 20} weight={variant === "floating" ? "bold" : "regular"} />
    </motion.span>
  );
  const dot = failed ? <span className="absolute right-2 top-2 size-2 rounded-full bg-danger ring-2 ring-surface" /> : null;

  if (variant === "icon") {
    return (
      <button
        aria-label="Sync now"
        onClick={() => !running && sync.mutate()}
        className="relative grid size-10 place-items-center rounded-xl text-muted-foreground transition-transform active:scale-90 active:bg-surface-muted"
      >
        {icon}
        {dot}
      </button>
    );
  }
  return (
    <motion.button
      aria-label="Sync now"
      title="Sync now"
      onClick={() => !running && sync.mutate()}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.92 }}
      className={cn(
        "fixed bottom-6 right-6 z-[34] hidden size-12 place-items-center rounded-full border border-border bg-surface text-foreground shadow-float md:grid",
        running && "text-accent",
      )}
    >
      {icon}
      {dot}
    </motion.button>
  );
}
