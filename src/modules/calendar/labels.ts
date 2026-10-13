import { ArrowClockwise, Cake, Exam, Flag, Heart, Star } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

import type { AttendanceStatus, ClassKind, DateKind } from "@/core/db/schema";
import { daysBetween, todayKey } from "@/lib/dates";

export const KIND_LABEL: Record<ClassKind, string> = { lecture: "Lecture", lab: "Lab", tutorial: "Tutorial" };

export const DATE_KINDS: { value: DateKind; label: string }[] = [
  { value: "birthday", label: "Birthday" },
  { value: "anniversary", label: "Anniversary" },
  { value: "exam", label: "Exam" },
  { value: "deadline", label: "Deadline" },
  { value: "renewal", label: "Renewal / expiry" },
  { value: "other", label: "Other" },
];

export const STATUS_COLOR: Record<AttendanceStatus, string> = {
  present: "#3fa66b",
  absent: "#e05a5a",
  excused: "#d4a02c",
};

export const DATE_STYLE: Record<DateKind, { icon: Icon; hue: string }> = {
  birthday: { icon: Cake, hue: "#d9608f" },
  anniversary: { icon: Heart, hue: "#e05a5a" },
  exam: { icon: Exam, hue: "#5b6ee1" },
  deadline: { icon: Flag, hue: "#e8673a" },
  renewal: { icon: ArrowClockwise, hue: "#2fa5a0" },
  other: { icon: Star, hue: "#d4b62c" },
};

export function countdown(date: string, today = todayKey()): string {
  const d = daysBetween(today, date);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d < 0) return `${-d} days ago`;
  if (d < 60) return `in ${d} days`;
  return `in ${Math.round(d / 30)} months`;
}

