import { addMonths, addYears } from "date-fns";

import type { Recurrence } from "@/core/db/schema";
import { addDaysKey, fromKey, isoWeekday, toKey, type DateKey } from "@/lib/dates";

/**
 * Next due date after completing a recurring task. Counts from the due date
 * (or today if it had none), and never returns a date before `today + 1` so
 * an overdue daily task doesn't come back already overdue.
 */
export function nextDue(recurrence: Recurrence, due: DateKey | null, today: DateKey): DateKey {
  let next = advance(recurrence, due ?? today);
  while (next <= today) next = advance(recurrence, next);
  return next;
}

function advance(recurrence: Recurrence, from: DateKey): DateKey {
  switch (recurrence) {
    case "daily":
      return addDaysKey(from, 1);
    case "weekdays": {
      let next = addDaysKey(from, 1);
      while (isoWeekday(next) > 5) next = addDaysKey(next, 1);
      return next;
    }
    case "weekly":
      return addDaysKey(from, 7);
    case "monthly":
      return toKey(addMonths(fromKey(from), 1));
    case "yearly":
      return toKey(addYears(fromKey(from), 1));
  }
}

export const recurrenceLabel: Record<Recurrence, string> = {
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};
