/**
 * Asks a module page to open one of its items, e.g. after picking a search
 * result. The palette sets the request and navigates; the page takes it once
 * its data has loaded.
 */
import { useEffect } from "react";
import { create } from "zustand";

export interface OpenTarget {
  /** Search index module: todo, watch, read, habits, dates, subjects, people, debts, goals. */
  module: string;
  /** An item id, or "new" to start creating one. */
  id: string;
  /** Prefilled fields when creating, e.g. a goal started from elsewhere. */
  draft?: { title?: string; notes?: string };
}

/** Requests older than this are dropped, so one the page never took can't fire later. */
const FRESH_MS = 5_000;

export const useOpenRequest = create<{ target: OpenTarget | null; at: number; request: (t: OpenTarget) => void; clear: () => void }>((set) => ({
  target: null,
  at: 0,
  request: (target) => set({ target, at: Date.now() }),
  clear: () => set({ target: null }),
}));

/** Calls `onOpen` for a pending request aimed at one of `modules`, once `ready`. */
export function useOpenTarget(modules: string[], ready: boolean, onOpen: (target: OpenTarget) => void) {
  const target = useOpenRequest((s) => s.target);
  const key = modules.join(",");
  useEffect(() => {
    if (!ready || !target || !key.split(",").includes(target.module)) return;
    const fresh = Date.now() - useOpenRequest.getState().at < FRESH_MS;
    useOpenRequest.getState().clear();
    if (fresh) onOpen(target);
    // `onOpen` is a fresh closure each render; the request is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, target, key]);
}
