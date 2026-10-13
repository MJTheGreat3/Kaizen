import { useEffect } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AnimatePresence, MotionConfig, motion } from "motion/react";

import { useScheduledBackup } from "@/core/backup/useScheduledBackup";
import { LoadingScreen, RecoveryKeyScreen, SetupScreen, UnlockScreen } from "@/core/security/LockScreens";
import { useSession } from "@/core/security/session";
import { useAutoLock } from "@/core/security/useAutoLock";
import { useNotificationSync } from "@/core/notifications/scheduler";
import { useTheme } from "@/core/theme";
import { log } from "@/lib/log";
import { ease } from "@/lib/motion";
import { router } from "./router";

export function App() {
  const phase = useSession((s) => s.phase);
  const info = useSession((s) => s.info);
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
  useNotificationSync(unlocked, info?.platform === "android" ? "android" : "desktop");

  return (
    <>
      <MotionConfig reducedMotion="user">
        <AnimatePresence mode="wait">
          <motion.div
            key={phase.kind === "unlocked" ? "app" : phase.kind}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.985, transition: { duration: 0.22, ease } }}
            transition={{ duration: 0.35, ease }}
          >
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
          </motion.div>
        </AnimatePresence>
      </MotionConfig>
      {/* Film grain over everything for a little depth. */}
      <div aria-hidden className="grain-surface pointer-events-none fixed inset-0 z-[60] opacity-[var(--grain-opacity)]" />
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
