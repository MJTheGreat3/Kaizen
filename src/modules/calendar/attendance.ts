/**
 * Timetable and attendance maths. Class occurrences are generated from the
 * weekly slots plus exceptions; only marked classes are stored.
 */
import type {
  AttendanceMark,
  AttendanceStatus,
  ClassKind,
  Semester,
  Subject,
  TimetableException,
  TimetableSlot,
} from "@/core/db/schema";
import { addDaysKey, daysBetween, isoWeekday, type DateKey } from "@/lib/dates";

export interface Occurrence {
  key: string;
  date: DateKey;
  subjectId: string;
  kind: ClassKind;
  startMin: number;
  endMin: number;
  room: string | null;
  slotId: string | null;
  extraId: string | null;
  cancelled: boolean;
  cancelId: string | null;
}

type SemesterLike = Pick<Semester, "startDate" | "endDate">;
type SlotLike = Pick<TimetableSlot, "id" | "subjectId" | "weekday" | "startMin" | "endMin" | "kind" | "room" | "weekParity">;
type ExceptionLike = Pick<
  TimetableException,
  "id" | "kind" | "date" | "endDate" | "slotId" | "subjectId" | "classKind" | "startMin" | "endMin" | "room" | "title"
>;

/** Week number within the semester, starting at 1 (weeks start on Monday). */
export function semesterWeek(semester: SemesterLike, day: DateKey): number {
  const firstMonday = addDaysKey(semester.startDate, 1 - isoWeekday(semester.startDate));
  return Math.floor(daysBetween(firstMonday, day) / 7) + 1;
}

/** Holiday or vacation covering this day, if any. */
export function dayOff(exceptions: ExceptionLike[], day: DateKey): ExceptionLike | null {
  return (
    exceptions.find(
      (e) =>
        (e.kind === "holiday" && e.date === day) ||
        (e.kind === "vacation" && e.date <= day && day <= (e.endDate ?? e.date)),
    ) ?? null
  );
}

export function occurrencesOn(
  semester: SemesterLike,
  slots: SlotLike[],
  exceptions: ExceptionLike[],
  day: DateKey,
): Occurrence[] {
  if (day < semester.startDate || day > semester.endDate) return [];
  if (dayOff(exceptions, day)) return [];
  const weekday = isoWeekday(day);
  const week = semesterWeek(semester, day);
  const result: Occurrence[] = [];

  for (const slot of slots) {
    if (slot.weekday !== weekday) continue;
    if (slot.weekParity === "odd" && week % 2 === 0) continue;
    if (slot.weekParity === "even" && week % 2 === 1) continue;
    const cancel = exceptions.find((e) => e.kind === "cancel" && e.date === day && e.slotId === slot.id);
    result.push({
      key: `${day}:${slot.id}`,
      date: day,
      subjectId: slot.subjectId,
      kind: slot.kind,
      startMin: slot.startMin,
      endMin: slot.endMin,
      room: slot.room,
      slotId: slot.id,
      extraId: null,
      cancelled: !!cancel,
      cancelId: cancel?.id ?? null,
    });
  }

  for (const extra of exceptions) {
    if (extra.kind !== "extra" || extra.date !== day || !extra.subjectId) continue;
    const cancel = exceptions.find((e) => e.kind === "cancel" && e.date === day && e.slotId === `x:${extra.id}`);
    result.push({
      key: `${day}:x:${extra.id}`,
      date: day,
      subjectId: extra.subjectId,
      kind: extra.classKind ?? "lecture",
      startMin: extra.startMin ?? 0,
      endMin: extra.endMin ?? 60,
      room: extra.room,
      slotId: null,
      extraId: extra.id,
      cancelled: !!cancel,
      cancelId: cancel?.id ?? null,
    });
  }

  return result.sort((a, b) => a.startMin - b.startMin);
}

export function occurrencesBetween(
  semester: SemesterLike,
  slots: SlotLike[],
  exceptions: ExceptionLike[],
  from: DateKey,
  to: DateKey,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (let day = from; day <= to; day = addDaysKey(day, 1)) {
    out.push(...occurrencesOn(semester, slots, exceptions, day));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export type Component = "all" | "lecture" | "lab" | "tutorial";

export interface ComponentStats {
  component: Component;
  attended: number;
  held: number;
  unmarked: number;
  remaining: number;
  /** 0-100, or null before any class was held. */
  percent: number | null;
  target: number;
  /** Classes that can be missed now while staying at or above target. */
  canSkip: number;
  /** Consecutive classes needed to get back to target (0 when on track). */
  mustAttend: number;
  /** Percentage at semester end if every remaining class is attended. */
  bestFinal: number | null;
}

export type SemesterCounting = Pick<Semester, "separateLabs" | "separateTutorials" | "unmarkedDefault" | "target">;

export function componentOf(kind: ClassKind, counting: SemesterCounting): Component {
  if (kind === "lab" && counting.separateLabs) return "lab";
  if (kind === "tutorial" && counting.separateTutorials) return "tutorial";
  return counting.separateLabs || counting.separateTutorials ? "lecture" : "all";
}

export function statsFor(
  occurrences: Occurrence[],
  marks: Map<string, AttendanceStatus>,
  now: { day: DateKey; minutes: number },
  target: number,
  component: Component,
  unmarkedDefault: SemesterCounting["unmarkedDefault"],
): ComponentStats {
  let attended = 0;
  let held = 0;
  let unmarked = 0;
  let remaining = 0;
  for (const o of occurrences) {
    if (o.cancelled) continue;
    const over = o.date < now.day || (o.date === now.day && o.endMin <= now.minutes);
    const status = marks.get(o.key);
    if (!over && !status) {
      remaining++;
      continue;
    }
    if (!status) {
      unmarked++;
      if (unmarkedDefault === "present") {
        held++;
        attended++;
      }
      continue;
    }
    held++;
    if (status === "present" || status === "excused") attended++;
  }
  const t = target / 100;
  const canSkip = held === 0 ? 0 : Math.max(0, Math.floor(attended / t - held + 1e-9));
  const mustAttend = attended >= t * held ? 0 : Math.ceil((t * held - attended) / (1 - t) - 1e-9);
  const total = held + remaining;
  return {
    component,
    attended,
    held,
    unmarked,
    remaining,
    percent: held ? (attended / held) * 100 : null,
    target,
    canSkip,
    mustAttend,
    bestFinal: total ? ((attended + remaining) / total) * 100 : null,
  };
}

/** Per-component statistics for one subject across the whole semester. */
export function subjectStats(
  subject: Pick<Subject, "id" | "target">,
  semester: SemesterCounting & SemesterLike,
  allOccurrences: Occurrence[],
  marks: AttendanceMark[],
  now: { day: DateKey; minutes: number },
): ComponentStats[] {
  const target = subject.target ?? semester.target;
  const statusByKey = new Map(marks.map((m) => [m.classKey, m.status]));
  const mine = allOccurrences.filter((o) => o.subjectId === subject.id);
  const groups = new Map<Component, Occurrence[]>();
  for (const o of mine) {
    const c = componentOf(o.kind, semester);
    groups.set(c, [...(groups.get(c) ?? []), o]);
  }
  const order: Component[] = ["all", "lecture", "lab", "tutorial"];
  return order
    .filter((c) => groups.has(c))
    .map((c) => statsFor(groups.get(c)!, statusByKey, now, target, c, semester.unmarkedDefault));
}

export const componentLabel: Record<Component, string> = {
  all: "Overall",
  lecture: "Lectures",
  lab: "Labs",
  tutorial: "Tutorials",
};
