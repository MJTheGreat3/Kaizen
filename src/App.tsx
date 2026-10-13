import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Toaster } from "sonner";

import { useScheduledBackup } from "@/core/backup/useScheduledBackup";
import { LoadingScreen, RecoveryKeyScreen, SetupScreen, UnlockScreen } from "@/core/security/LockScreens";
import { useSession } from "@/core/security/session";
import { useAutoLock } from "@/core/security/useAutoLock";
import { useTheme } from "@/core/theme";
import { log } from "@/lib/log";
import { router } from "./router";

export function App() {
  const phase = useSession((s) => s.phase);
  const refresh = useSession((s) => s.refresh);
  const client = useQueryClient();
  const theme = useTheme();
  const unlocked = phase.kind === "unlocked";

  useEffect(() => {
    refresh().catch((e) => log.error(`startup failed: ${String(e)}`));
  }, [refresh]);

  // Cached query data belongs to the unlocked session; drop it on lock.
  useEffect(() => {
    if (!unlocked) client.clear();
  }, [unlocked, client]);

  useAutoLock(unlocked);
  useScheduledBackup(unlocked);

  return (
    <>
      {/* Keeps scrolled content from showing through the transparent status bar (edge-to-edge on Android). */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 h-[env(safe-area-inset-top)] bg-background" />
      {phase.kind === "loading" ? (
        <LoadingScreen />
      ) : phase.kind === "setup" ? (
        <SetupScreen />
      ) : phase.kind === "recovery" ? (
        <RecoveryKeyScreen recoveryKey={phase.recoveryKey} />
      ) : phase.kind === "locked" ? (
        <UnlockScreen deviceUnlock={phase.deviceUnlock} />
      ) : (
        <RouterProvider router={router} />
      )}
      <Toaster
        theme={theme}
        position="bottom-right"
        offset={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
        mobileOffset={{ bottom: "calc(5.5rem + env(safe-area-inset-bottom))" }}
        toastOptions={{ className: "!rounded-xl !border-border !bg-surface !text-foreground !shadow-float" }}
      />
    </>
  );
}
