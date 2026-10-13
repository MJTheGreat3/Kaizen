import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, desc, eq, isNull } from "drizzle-orm";

import { clearActivity, recordActivity } from "@/core/activity";
import { db, schema } from "@/core/db/client";
import type {
  AttendanceMark,
  AttendanceStatus,
  ImportantDate,
  Semester,
  Subject,
  TimetableException,
  TimetableSlot,
} from "@/core/db/schema";
import { addDaysKey, todayKey, type DateKey } from "@/lib/dates";
import type { Occurrence } from "./attendance";

export interface CalendarData {
  semester: Semester | null;
  subjects: Subject[];
  slots: TimetableSlot[];
  exceptions: TimetableException[];
  marks: AttendanceMark[];
}

export async function loadCalendar(): Promise<CalendarData> {
  const semester =
    (await db
      .select()
      .from(schema.semesters)
      .where(and(isNull(schema.semesters.deletedAt), eq(schema.semesters.isActive, true)))
      .orderBy(desc(schema.semesters.startDate))
      .get()) ?? null;
  if (!semester) return { semester: null, subjects: [], slots: [], exceptions: [], marks: [] };
  const { subjects: sub, timetableSlots: slt, timetableExceptions: exc, attendance: att } = schema;
  const [subjects, slots, exceptions, marks] = await Promise.all([
    db.select().from(sub).where(and(isNull(sub.deletedAt), eq(sub.semesterId, semester.id))),
    db.select().from(slt).where(and(isNull(slt.deletedAt), eq(slt.semesterId, semester.id))),
    db.select().from(exc).where(and(isNull(exc.deletedAt), eq(exc.semesterId, semester.id))),
    db.select().from(att).where(and(isNull(att.deletedAt), eq(att.semesterId, semester.id))),
  ]);
  return { semester, subjects, slots, exceptions, marks };
}

export function useCalendar() {
  return useQuery({ queryKey: ["calendar"], queryFn: loadCalendar });
}

function useCalendarMutation<A>(fn: (a: A) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["calendar"] });
      client.invalidateQueries({ queryKey: ["dates"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Semester, subjects, slots
// ---------------------------------------------------------------------------

export type SemesterInput = Pick<
  Semester,
  "name" | "startDate" | "endDate" | "target" | "separateLabs" | "separateTutorials" | "unmarkedDefault" | "reminderMinutes"
>;

export function useSaveSemester() {
  return useCalendarMutation(async ({ id, ...input }: SemesterInput & { id?: string }) => {
    if (id) {
      await db.update(schema.semesters).set(input).where(eq(schema.semesters.id, id));
    } else {
      await db.update(schema.semesters).set({ isActive: false }).where(eq(schema.semesters.isActive, true));
      await db.insert(schema.semesters).values({ ...input, isActive: true });
    }
  });
}

export type SubjectInput = Pick<Subject, "name" | "code" | "professor" | "color" | "target">;

export function useSaveSubject() {
  return useCalendarMutation(async ({ id, semesterId, ...input }: SubjectInput & { id?: string; semesterId: string }) => {
    if (id) await db.update(schema.subjects).set(input).where(eq(schema.subjects.id, id));
    else await db.insert(schema.subjects).values({ ...input, semesterId });
  });
}

export function useDeleteSubject() {
  return useCalendarMutation(async (id: string) => {
    const now = Date.now();
    await db.update(schema.timetableSlots).set({ deletedAt: now }).where(eq(schema.timetableSlots.subjectId, id));
    await db.update(schema.subjects).set({ deletedAt: now }).where(eq(schema.subjects.id, id));
  });
}

export type SlotInput = Pick<TimetableSlot, "subjectId" | "weekday" | "startMin" | "endMin" | "kind" | "room" | "weekParity">;

export function useSaveSlot() {
  return useCalendarMutation(async ({ id, semesterId, ...input }: SlotInput & { id?: string; semesterId: string }) => {
    if (id) await db.update(schema.timetableSlots).set(input).where(eq(schema.timetableSlots.id, id));
    else await db.insert(schema.timetableSlots).values({ ...input, semesterId });
  });
}

export function useDeleteSlot() {
  return useCalendarMutation((id: string) =>
    db.update(schema.timetableSlots).set({ deletedAt: Date.now() }).where(eq(schema.timetableSlots.id, id)),
  );
}

/** Copies every class on one weekday to other weekdays. */
export function useCopyDay() {
  return useCalendarMutation(async ({ slots, from, to, semesterId }: { slots: TimetableSlot[]; from: number; to: number[]; semesterId: string }) => {
    for (const day of to) {
      for (const s of slots.filter((x) => x.weekday === from)) {
        await db.insert(schema.timetableSlots).values({
          semesterId,
          subjectId: s.subjectId,
          weekday: day,
          startMin: s.startMin,
          endMin: s.endMin,
          kind: s.kind,
          room: s.room,
          weekParity: s.weekParity,
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Exceptions: extra classes, cancellations, holidays, vacations
// ---------------------------------------------------------------------------

export type ExceptionInput = Omit<
  TimetableException,
  "id" | "semesterId" | "createdAt" | "updatedAt" | "deletedAt" | "deviceId"
>;

export function useAddException() {
  return useCalendarMutation(({ semesterId, ...input }: Partial<ExceptionInput> & Pick<ExceptionInput, "kind" | "date"> & { semesterId: string }) =>
    db.insert(schema.timetableExceptions).values({ semesterId, ...input }),
  );
}

export function useDeleteException() {
  return useCalendarMutation((id: string) =>
    db.update(schema.timetableExceptions).set({ deletedAt: Date.now() }).where(eq(schema.timetableExceptions.id, id)),
  );
}

/** Cancels one class. Extra classes are simply removed. */
export function useCancelClass() {
  return useCalendarMutation(async ({ occ, semesterId }: { occ: Occurrence; semesterId: string }) => {
    if (occ.extraId) {
      await db.update(schema.timetableExceptions).set({ deletedAt: Date.now() }).where(eq(schema.timetableExceptions.id, occ.extraId));
    } else {
      await db.insert(schema.timetableExceptions).values({ semesterId, kind: "cancel", date: occ.date, slotId: occ.slotId });
    }
    await unmark(occ.key);
  });
}

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

async function unmark(classKey: string) {
  await db.delete(schema.attendance).where(eq(schema.attendance.classKey, classKey));
  await clearActivity("attendance", classKey);
}

export async function markClass(occ: Occurrence, semesterId: string, status: AttendanceStatus | null) {
  await unmark(occ.key);
  if (!status) return;
  await db.insert(schema.attendance).values({
    semesterId,
    subjectId: occ.subjectId,
    classKey: occ.key,
    date: occ.date,
    classKind: occ.kind,
    status,
  });
  if (status !== "absent") await recordActivity("classes", occ.date, "attendance", occ.key);
}

export function useMarkClass() {
  return useCalendarMutation(({ occ, semesterId, status }: { occ: Occurrence; semesterId: string; status: AttendanceStatus | null }) =>
    markClass(occ, semesterId, status),
  );
}

export function useMarkMany() {
  return useCalendarMutation(async ({ occs, semesterId, status }: { occs: Occurrence[]; semesterId: string; status: AttendanceStatus }) => {
    for (const o of occs) await markClass(o, semesterId, status);
  });
}

// ---------------------------------------------------------------------------
// Important dates
// ---------------------------------------------------------------------------

export async function loadDates(): Promise<ImportantDate[]> {
  return db.select().from(schema.importantDates).where(isNull(schema.importantDates.deletedAt));
}

export function useDates() {
  return useQuery({ queryKey: ["dates"], queryFn: loadDates });
}

export type DateInput = Pick<ImportantDate, "title" | "kind" | "date" | "recurrence" | "remindOffsets" | "notes">;

export function useSaveDate() {
  return useCalendarMutation(async ({ id, ...input }: DateInput & { id?: string }) => {
    if (id) await db.update(schema.importantDates).set(input).where(eq(schema.importantDates.id, id));
    else await db.insert(schema.importantDates).values(input);
  });
}

export function useDeleteDate() {
  return useCalendarMutation((id: string) =>
    db.update(schema.importantDates).set({ deletedAt: Date.now() }).where(eq(schema.importantDates.id, id)),
  );
}

/** Next date an important date falls on, from `today` (inclusive). */
export function nextOccurrence(d: Pick<ImportantDate, "date" | "recurrence">, today: DateKey = todayKey()): DateKey | null {
  if (d.recurrence === "none") return d.date >= today ? d.date : null;
  const [, m, day] = d.date.split("-").map(Number);
  const [ty, tm] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clampDay = (y: number, mo: number) => Math.min(day, new Date(y, mo, 0).getDate());
  if (d.recurrence === "yearly") {
    let candidate = `${ty}-${pad(m)}-${pad(clampDay(ty, m))}`;
    if (candidate < today) candidate = `${ty + 1}-${pad(m)}-${pad(clampDay(ty + 1, m))}`;
    return candidate < d.date ? d.date : candidate;
  }
  let y = ty;
  let mo = tm;
  for (let i = 0; i < 14; i++) {
    const candidate = `${y}-${pad(mo)}-${pad(clampDay(y, mo))}`;
    if (candidate >= today && candidate >= d.date) return candidate;
    mo++;
    if (mo > 12) {
      mo = 1;
      y++;
    }
  }
  return null;
}

/** Days within the next `days` days, as `{ date, item }` sorted by date. */
export function upcomingDates(items: ImportantDate[], today: DateKey, days: number) {
  const limit = addDaysKey(today, days);
  return items
    .map((item) => ({ item, date: nextOccurrence(item, today) }))
    .filter((x): x is { item: ImportantDate; date: DateKey } => !!x.date && x.date <= limit)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
