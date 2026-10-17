import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

import { useOpenRequest } from "@/core/shell/openRequest";
import { pathOf } from "@/modules/registry";
import { useCapture } from "./store";

/** App shortcuts that open a page rather than quick capture. */
const SHORTCUTS: Record<string, { module: string; id: string; page: string }> = {
  reading: { module: "read", id: "session", page: "lists" },
  gym: { module: "fitness", id: "start", page: "fitness" },
  sports: { module: "sports", id: "new", page: "sports" },
  board: { module: "canvas", id: "new", page: "canvas" },
  debt: { module: "debts", id: "new", page: "debts" },
  activity: { module: "activity", id: "open", page: "activity" },
  music: { module: "music", id: "open", page: "music" },
  debts: { module: "debts", id: "open", page: "debts" },
};

/**
 * Brings in what the phone handed to Kaizen (shares, app shortcuts, the
 * Quick Settings tile, widgets) and the laptop's quick capture shortcut.
 */
export function useIntake(platform: "android" | "desktop" | string) {
  const open = useCapture((s) => s.open);
  const navigate = useNavigate();

  useEffect(() => {
    if (platform === "android") return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen("capture://open", () => open({})).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      }),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [platform, open]);

  useEffect(() => {
    if (platform !== "android") return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const { ipc } = await import("@/lib/ipc");
        for (const item of await ipc.intakeTake(false)) {
          const target = item.source === "capture" ? SHORTCUTS[item.kind ?? ""] : undefined;
          if (item.source === "capture" && item.kind?.startsWith("page:")) {
            // A widget opening its page.
            void navigate({ to: pathOf(item.kind.slice(5)) });
          } else if (target) {
            useOpenRequest.getState().request({ module: target.module, id: target.id });
            void navigate({ to: pathOf(target.page) });
          } else if (item.source === "capture") {
            open({ kind: (item.kind as "task" | "watch" | "read") || "" });
          } else {
            const text = [item.subject && !item.text?.includes(item.subject) ? item.subject : null, item.text]
              .filter(Boolean)
              .join("\n");
            open({ text, image: item.image ? `data:${item.mime ?? "image/jpeg"};base64,${item.image}` : undefined });
          }
        }
      } catch {
        // Checked again shortly.
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(check, 1500);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [platform, open, navigate]);
}
