import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { ipc } from "@/lib/ipc";

/**
 * Private files (progress photos) are the one thing still behind the
 * passphrase. Rust keeps them open for 10 minutes after it is entered; they
 * close sooner when Kaizen goes to the background.
 */
interface PrivateState {
  open: boolean;
  check: () => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
}

export const usePrivate = create<PrivateState>((set) => ({
  open: false,
  check: async () => set({ open: await ipc.privateStatus().catch(() => false) }),
  unlock: async (passphrase) => {
    await ipc.privateUnlock(passphrase);
    set({ open: true });
  },
  lock: async () => {
    await ipc.privateLock().catch(() => undefined);
    set({ open: false });
  },
}));

/**
 * Keeps the open state current while a page with private files is shown,
 * and drops decrypted photos from the cache once they close.
 */
export function usePrivateFiles() {
  const open = usePrivate((s) => s.open);
  const client = useQueryClient();

  useEffect(() => {
    const { check, lock } = usePrivate.getState();
    void check();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void lock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const timer = setInterval(() => void check(), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open) client.removeQueries({ queryKey: ["gym-photo"] });
  }, [open, client]);

  return open;
}
