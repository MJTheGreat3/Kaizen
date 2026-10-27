import { useCallback, useEffect } from "react";
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
  expense: { module: "finance", id: "new-expense", page: "finance" },
  income: { module: "finance", id: "new-income", page: "finance" },
};

/**
 * Brings in what the phone handed to Kaizen (shares, app shortcuts, the
 * Quick Settings tile, widgets), the laptop's quick capture shortcut and
 * links on the Mac's desktop widgets.
 */
export function useIntake(platform: "android" | "desktop" | string) {
  const open = useCapture((s) => s.open);
  const navigate = useNavigate();

  /** A shortcut or widget kind: a page (`page:goals`), a page action (`expense`) or quick capture (`task`). */
  const openKind = useCallback(
    (kind: string) => {
      const target = SHORTCUTS[kind];
      if (kind.startsWith("page:")) {
        void navigate({ to: pathOf(kind.slice(5)) });
      } else if (target) {
        useOpenRequest.getState().request({ module: target.module, id: target.id });
        void navigate({ to: pathOf(target.page) });
      } else {
        open({ kind: (kind as "task" | "watch" | "read") || "" });
      }
    },
    [navigate, open],
  );

  useEffect(() => {
    if (platform === "android") return;
    const unlisten: (() => void)[] = [];
    let cancelled = false;
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      for (const fn of [
        await listen("capture://open", () => open({})),
        await listen<string>("widget://open", (e) => openKind(e.payload)),
      ]) {
        if (cancelled) fn();
        else unlisten.push(fn);
      }
    });
    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, [platform, open, openKind]);

  useEffect(() => {
    if (platform !== "android") return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const { ipc } = await import("@/lib/ipc");
        for (const item of await ipc.intakeTake(false)) {
          if (item.source === "capture") {
            openKind(item.kind ?? "");
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
  }, [platform, open, openKind]);
}
