import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Minus, Plus, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { playChime } from "@/lib/chime";
import { useNow } from "@/lib/time";
import { formatSeconds } from "./logic";
import { useRest } from "./restStore";

async function notify(title: string, body: string) {
  try {
    const n = await import("@tauri-apps/plugin-notification");
    if ((await n.isPermissionGranted()) === true) n.sendNotification({ title, body });
  } catch {
    // The chime still plays.
  }
}

/** Counts down at the bottom of the screen; chimes, buzzes and notifies at the end. */
export function RestBar({ hue }: { hue: string }) {
  const { endsAt, total, add, stop } = useRest();
  const now = useNow(250).getTime();
  const left = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;
  const fired = useRef<number | null>(null);

  useEffect(() => {
    if (!endsAt || left > 0 || fired.current === endsAt) return;
    fired.current = endsAt;
    playChime();
    navigator.vibrate?.([200, 100, 200]);
    if (document.hidden) void notify("Rest over", "Time for your next set.");
    const t = setTimeout(stop, 4000);
    return () => clearTimeout(t);
  }, [endsAt, left, stop]);

  return (
    <AnimatePresence>
      {endsAt ? (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+72px)] z-40 mx-auto w-[min(420px,calc(100%-32px))] overflow-hidden rounded-2xl border border-border bg-surface shadow-float md:bottom-6"
          role="timer"
          aria-label="Rest timer"
        >
          <span className="absolute inset-y-0 left-0 opacity-15 transition-[width] duration-200" style={{ width: `${(left / Math.max(1, total)) * 100}%`, background: hue }} />
          <div className="relative flex items-center gap-2 px-3 py-2">
            <span className="grid flex-1">
              <span className="text-[12px] font-medium text-muted-foreground">{left ? "Rest" : "Rest over"}</span>
              <span className="text-[22px] font-semibold leading-none tabular-nums">{formatSeconds(left)}</span>
            </span>
            <Button size="sm" variant="secondary" aria-label="15 seconds less" onClick={() => add(-15)}>
              <Minus />
              15
            </Button>
            <Button size="sm" variant="secondary" aria-label="15 seconds more" onClick={() => add(15)}>
              <Plus />
              15
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Skip rest" onClick={stop}>
              <X />
            </Button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
