import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { syncNow } from "./autosync";

/** "Sync now" with a toast describing the outcome. */
export function useSyncAction() {
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
