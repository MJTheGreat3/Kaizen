import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "in 3 h 20 min", "in 2 days", "now". */
export function timeUntil(ms: number, now = Date.now()): string {
  const m = Math.round((ms - now) / 60_000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  if (m < 24 * 60) return `in ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  const d = Math.round(m / (24 * 60));
  return `in ${d} ${d === 1 ? "day" : "days"}`;
}
