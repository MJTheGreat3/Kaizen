import { create } from "zustand";

import { ipc, type AppInfo, type Unlocked, type VaultStatus } from "@/lib/ipc";

type Phase =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "locked"; deviceUnlock: boolean }
  /** Just created: the recovery key must be shown before entering the app. */
  | { kind: "recovery"; recoveryKey: string }
  | { kind: "unlocked" };

interface SessionState {
  phase: Phase;
  info: AppInfo | null;
  deviceId: string | null;
  refresh: () => Promise<void>;
  onUnlocked: (result: Unlocked) => void;
  acknowledgeRecoveryKey: () => void;
  lock: () => Promise<void>;
}

function phaseFrom(status: VaultStatus): Phase {
  if (!status.initialized) return { kind: "setup" };
  if (!status.unlocked) return { kind: "locked", deviceUnlock: status.deviceUnlock };
  return { kind: "unlocked" };
}

export const useSession = create<SessionState>((set, get) => ({
  phase: { kind: "loading" },
  info: null,
  deviceId: null,

  refresh: async () => {
    const [info, status] = await Promise.all([get().info ?? ipc.appInfo(), ipc.vaultStatus()]);
    // A session that is still open on the Rust side (e.g. after a reload) is
    // locked again so the frontend always starts from a known state.
    if (status.unlocked) {
      await ipc.vaultLock();
      status.unlocked = false;
    }
    set({ info, phase: phaseFrom(status), deviceId: null });
  },

  onUnlocked: (result) => {
    set({
      deviceId: result.deviceId,
      phase: result.recoveryKey ? { kind: "recovery", recoveryKey: result.recoveryKey } : { kind: "unlocked" },
    });
  },

  acknowledgeRecoveryKey: () => set({ phase: { kind: "unlocked" } }),

  lock: async () => {
    await ipc.vaultLock();
    const status = await ipc.vaultStatus();
    set({ phase: phaseFrom(status), deviceId: null });
  },
}));

/** Used by the schema to stamp rows with this device's id. */
export function currentDeviceId(): string {
  const id = useSession.getState().deviceId;
  if (!id) throw new Error("No device id: the app is locked");
  return id;
}

export function isMobile(info: AppInfo | null): boolean {
  return info?.platform === "android" || info?.platform === "ios";
}
