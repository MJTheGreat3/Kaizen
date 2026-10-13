import { ipc } from "./ipc";

type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, message: string) {
  const consoleFn = level === "debug" ? console.debug : console[level];
  consoleFn(`[kaizen] ${message}`);
  // Forwarded to the Rust log file; never let logging itself throw.
  ipc.logFrontend(level, message).catch(() => {});
}

/** Frontend logger. Messages also land in the app's log file. */
export const log = {
  debug: (m: string) => write("debug", m),
  info: (m: string) => write("info", m),
  warn: (m: string) => write("warn", m),
  error: (m: string) => write("error", m),
};
