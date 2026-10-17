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
  | "private_locked";

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

export interface IntakeItem {
  source: "share" | "capture";
  /** Capture: task, watch, read, a page shortcut, or empty for any. */
  kind?: string;
  subject?: string;
  text?: string;
  /** Shared image, base64. */
  image?: string;
  mime?: string;
}

export interface MusicStatus {
  /** This build has a Spotify Client ID. */
  configured: boolean;
  connected: boolean;
  name: string | null;
  redirectUri: string;
}

export interface Lyrics {
  /** LRC text, when timed lyrics exist. */
  synced: string | null;
  plain: string | null;
  instrumental: boolean;
}

export type Platform = "macos" | "windows" | "linux" | "android" | "ios";

export interface AppInfo {
  version: string;
  platform: Platform;
  dataDir: string;
  logDir: string;
  defaultBackupDir: string;
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

export interface SportCandidate {
  id: string;
  sport: "nba" | "football" | "cricket";
  kind: "team" | "player";
  ref: string;
  name: string;
  subtitle: string | null;
  league: string | null;
  image: string | null;
}

export interface SportAlert {
  key: string;
  title: string;
  body: string;
  muteId: string | null;
  url: string | null;
}

export interface SportsReport {
  updated: number;
  errors: string[];
  /** Results and performances to announce; Android has already shown them. */
  alerts: SportAlert[];
}

export interface GameReminder {
  key: string;
  at: number;
  title: string;
  body: string;
  muteId: string | null;
  url: string | null;
}

export interface GitHubReport {
  contributions: number;
  error: string | null;
}

/** A book, film, show or anime found for a list item. */
export interface MediaFound {
  sourceId: string;
  title: string;
  creator: string | null;
  year: number | null;
  medium: "book" | "movie" | "show" | "anime";
  pages: number | null;
  episodes: number | null;
  runtimeMinutes: number | null;
  genres: string[];
  cover: string | null;
}

export const ipc = {
  appInfo: () => call<AppInfo>("app_info"),

  vaultStatus: () => call<VaultStatus>("vault_status"),
  vaultSetup: (passphrase: string) => call<Unlocked>("vault_setup", { passphrase }),
  vaultUnlock: (passphrase: string) => call<Unlocked>("vault_unlock", { passphrase }),
  vaultRecover: (recoveryKey: string, newPassphrase: string) =>
    call<Unlocked>("vault_recover", { recoveryKey, newPassphrase }),
  vaultUnlockDevice: () => call<Unlocked>("vault_unlock_device"),
  mediaSearch: (list: "read" | "watch", query: string) => call<MediaFound[]>("media_search", { list, query }),
  privateStatus: () => call<boolean>("private_status"),
  privateUnlock: (passphrase: string) => call<void>("private_unlock", { passphrase }),
  privateLock: () => call<void>("private_lock"),
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
  sportsSearch: (sport: string, kind: string, query: string) => call<SportCandidate[]>("sports_search", { sport, kind, query }),
  sportsRefresh: (ids?: string[]) => call<SportsReport>("sports_refresh", { ids: ids ?? null }),
  /** Mutes or unmutes `game:{sport}:{id}` or `follow:{id}` (synced). */
  sportsMute: (id: string, title: string | null, on: boolean) => call<void>("sports_mute", { id, title, on }),
  /** Schedules game reminders natively (Android); false elsewhere. */
  sportsSchedule: (reminders: GameReminder[]) => call<boolean>("sports_schedule", { reminders }),
  /** Stores a file (base64) for a row, encrypted on this device. */
  attachmentAdd: (ownerTable: string, ownerId: string, fileName: string, mime: string | null, data: string) =>
    call<string>("attachment_add", { ownerTable, ownerId, fileName, mime, data }),
  /** A stored file as base64; fails when it lives on another device. */
  attachmentRead: (id: string) => call<string>("attachment_read", { id }),
  attachmentRemove: (id: string) => call<void>("attachment_remove", { id }),
  /** Saves base64 data to Downloads (Download/Kaizen on Android); returns the path. */
  exportSave: (name: string, data: string) => call<string>("export_save", { name, data }),
  musicStatus: () => call<MusicStatus>("music_status"),
  /** Opens Spotify's sign-in in the browser; resolves with the display name. */
  musicConnect: () => call<string>("music_connect"),
  musicDisconnect: () => call<void>("music_disconnect"),
  /** Spotify Web API call; `path` like `/me/player`. */
  musicApi: <T = unknown>(method: "GET" | "PUT" | "POST" | "DELETE", path: string, body?: unknown) =>
    call<T>("music_api", { method, path, body: body ?? null }),
  musicHistorySync: () => call<number>("music_history_sync"),
  /** Starts Spotify: `background` without showing it, `foreground` opens it (phone). False if not installed. */
  musicWake: (mode: "background" | "foreground") => call<boolean>("music_wake", { mode }),
  /** What was shared into Kaizen or asked by a shortcut, tile or widget since the last call (phone). */
  intakeTake: (returnToApp = false) => call<IntakeItem[]>("intake_take", { returnToApp }),
  /** Rewrites the phone's home-screen widget from the database (phone only). */
  widgetRefresh: (feed: unknown) => call<void>("widget_refresh", { feed }),
  musicLyrics: (track: string, artist: string, album: string, durationMs: number) =>
    call<Lyrics>("music_lyrics", { track, artist, album, durationMs }),

  logsTail: (lines: number) => call<string>("logs_tail", { lines }),
  logFrontend: (level: "debug" | "info" | "warn" | "error", message: string) =>
    call<void>("log_frontend", { level, message }),
};
