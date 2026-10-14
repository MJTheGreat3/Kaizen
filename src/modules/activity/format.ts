/** Reading activity quantities in each type's own terms. */

/** How a type's quantity reads. */
export function amount(typeId: string, q: number) {
  const n = Math.round(q * 10) / 10;
  const plural = (one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  switch (typeId) {
    case "focus":
    case "sports":
      return n >= 60 ? `${Math.floor(n / 60)} h${Math.round(n % 60) ? ` ${Math.round(n % 60)} min` : ""}` : `${n} min`;
    case "tasks":
      return plural("task");
    case "reading":
      return plural("book");
    case "habits":
      return plural("habit");
    case "classes":
      return plural("class", "classes");
    case "cp":
      return plural("problem");
    case "gym":
      return plural("session");
    case "github":
      return plural("contribution");
    default:
      return String(n);
  }
}

/** What each type's quantity counts (the stored `unit` predates the modules). */
export const UNITS: Record<string, string> = {
  focus: "minutes",
  sports: "minutes",
  tasks: "tasks",
  reading: "books",
  habits: "habits",
  classes: "classes",
  cp: "problems",
  gym: "sessions",
  github: "contributions",
};

/** Types whose quantity is minutes. */
export const isMinutes = (typeId: string) => UNITS[typeId] === "minutes";
