/**
 * Typed wrappers around the Rust commands in `src-tauri/src/commands.rs`.
 */
import { invoke } from "@tauri-apps/api/core";

export type ErrorCode =
  | "vault_missing"
  | "vault_exists"
  | "locked"
  | "wrong_secret"
  | "device_unlock_unavailable"
  | "invalid"
  | "db"
  | "io"
  | "json"
  | "crypto"
  | "keychain"
  | "tauri"
  | "http"
  | "cancelled";

export class AppError extends Error {
  constructor(
    public code: ErrorCode | "unknown",
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && "message" in e) {
      throw new AppError((e as { code: ErrorCode }).code, String((e as { message: unknown }).message));
    }
    throw new AppError("unknown", String(e));
  }
}

export type Platform = "macos" | "windows" | "linux" | "android" | "ios";

export interface AppInfo {
  version: string;
  platform: Platform;
  dataDir: string;
  logDir: string;
  defaultBackupDir: string;
  /** Touch ID is set up (macOS). */
  touchId: boolean;
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  deviceUnlock: boolean;
}

export interface Unlocked {
  deviceId: string;
  recoveryKey: string | null;
}

export interface BackupInfo {
  path: string;
  name: string;
  createdAt: number;
  schemaVersion: number;
  sizeBytes: number;
}

export interface SyncPeer {
  deviceId: string;
  name: string;
  platform: string;
  lastReceivedAt: number | null;
}

export interface SyncLogEntry {
  at: number;
  transport: "drive" | "folder" | "lan" | string;
  sent: number;
  received: number;
  error: string | null;
}

export interface SyncStatus {
  deviceId: string;
  /** Set once this device has started or joined a sync group. */
  groupId: string | null;
  driveAvailable: boolean;
  /** Connected Google account; empty string when its email is unknown. */
  driveAccount: string | null;
  /** Android background sync is on / can be turned on. */
  background: boolean;
  backgroundAvailable: boolean;
  peers: SyncPeer[];
  log: SyncLogEntry[];
}

export interface SyncReport {
  sent: number;
  received: number;
  peers: number;
  waiting: boolean;
}

export interface LanInfo {
  serving: boolean;
  port: number;
  addresses: string[];
}

export type QueryMethod = "run" | "all" | "values" | "get";

export interface PracticeReport {
  platform: string;
  newSolves: number;
  error: string | null;
}

export interface GitHubReport {
  contributions: number;
  error: string | null;
}

export const ipc = {
  appInfo: () => call<AppInfo>("app_info"),

  vaultStatus: () => call<VaultStatus>("vault_status"),
  vaultSetup: (passphrase: string) => call<Unlocked>("vault_setup", { passphrase }),
  vaultUnlock: (passphrase: string) => call<Unlocked>("vault_unlock", { passphrase }),
  vaultRecover: (recoveryKey: string, newPassphrase: string) =>
    call<Unlocked>("vault_recover", { recoveryKey, newPassphrase }),
  vaultUnlockDevice: () => call<Unlocked>("vault_unlock_device"),
  vaultSetDeviceUnlock: (enabled: boolean) => call<void>("vault_set_device_unlock", { enabled }),
  vaultLock: () => call<void>("vault_lock"),

  dbQuery: (sql: string, params: unknown[], method: QueryMethod) =>
    call<unknown[][]>("db_query", { sql, params, method }),

  backupCreate: (dir?: string | null) => call<BackupInfo>("backup_create", { dir: dir || null }),
  backupList: (dir?: string | null) => call<BackupInfo[]>("backup_list", { dir: dir || null }),
  backupPrune: (dir: string | null, keep: number) => call<number>("backup_prune", { dir: dir || null, keep }),
  backupRestore: (path: string) => call<void>("backup_restore", { path }),

  dataWipe: () => call<void>("data_wipe"),
  dataExportJson: (dir?: string | null) => call<string>("data_export_json", { dir: dir || null }),

  syncStatus: () => call<SyncStatus>("sync_status"),
  syncPairCode: () => call<string>("sync_pair_code"),
  syncJoin: (code: string) => call<void>("sync_join", { code }),
  syncLeave: () => call<void>("sync_leave"),
  syncDrive: () => call<SyncReport>("sync_drive"),
  syncDriveConnect: () => call<string>("sync_drive_connect"),
  syncDriveDisconnect: () => call<void>("sync_drive_disconnect"),
  syncFolder: (path: string) => call<SyncReport>("sync_folder", { path }),
  syncLan: (host: string | null) => call<SyncReport>("sync_lan", { host }),
  syncLanInfo: () => call<LanInfo>("sync_lan_info"),
  syncBackgroundSet: (enabled: boolean) => call<void>("sync_background_set", { enabled }),

  practiceRefresh: (platforms?: string[]) => call<PracticeReport[]>("practice_refresh", { platforms: platforms ?? null }),
  practiceContests: () => call<number>("practice_contests"),
  githubRefresh: () => call<GitHubReport | null>("github_refresh"),

  logsTail: (lines: number) => call<string>("logs_tail", { lines }),
  logFrontend: (level: "debug" | "info" | "warn" | "error", message: string) =>
    call<void>("log_frontend", { level, message }),
};
