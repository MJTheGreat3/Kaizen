/**
 * Pull down from the top of any page on the phone to open search. A pill
 * follows the finger and opens the palette past the threshold.
 */
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { MagnifyingGlass } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { usePalette } from "./palette";

const THRESHOLD = 90;

export function PullToSearch() {
  const [pull, setPull] = useState(0);

  useEffect(() => {
    let startY: number | null = null;
    let startX = 0;
    let distance = 0;

    function onStart(e: TouchEvent) {
      const target = e.target as Element | null;
      // Only from the very top, outside dialogs and sideways scrollers.
      if (window.scrollY > 0 || usePalette.getState().open || target?.closest("[role=dialog], [data-no-pull], .overflow-x-auto, input, textarea")) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      distance = 0;
    }

    function onMove(e: TouchEvent) {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      if (dy <= 0 || dx > dy || window.scrollY > 0) {
        startY = null;
        setPull(0);
        return;
      }
      // Resistance, so the pill trails the finger.
      distance = Math.min(THRESHOLD * 1.4, dy * 0.55);
      setPull(distance);
    }

    function onEnd() {
      if (startY !== null && distance >= THRESHOLD) usePalette.getState().setOpen(true);
      startY = null;
      distance = 0;
      setPull(0);
    }

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const ready = pull >= THRESHOLD;
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-30 flex justify-center md:hidden"
      animate={{ y: pull ? pull - 44 : -60, opacity: pull > 12 ? 1 : 0 }}
      transition={pull ? { duration: 0 } : { duration: 0.25 }}
    >
      <span
        className={cn(
          "flex h-9 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-[13px] font-medium shadow-float transition-colors",
          ready ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <MagnifyingGlass size={16} weight={ready ? "bold" : "regular"} />
        {ready ? "Release to search" : "Pull to search"}
      </span>
    </motion.div>
  );
}
