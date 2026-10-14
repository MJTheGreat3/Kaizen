import { useQuery } from "@tanstack/react-query";

import { db, schema } from "@/core/db/client";
import type { SearchRow } from "@/core/db/schema";
import { modules } from "@/modules/registry";

/** Every indexed row; matching happens in memory (see `match.ts`). */
export function useSearchRows(enabled: boolean) {
  return useQuery({
    queryKey: ["search-index"],
    queryFn: (): Promise<SearchRow[]> => db.select().from(schema.searchIndex),
    enabled,
    staleTime: 0,
  });
}

export interface ModuleInfo {
  label: string;
  /** Registry module the row opens in. */
  moduleId: string;
}

/** Search index modules in display order. */
export const SEARCH_MODULES: Record<string, ModuleInfo> = {
  todo: { label: "Tasks", moduleId: "lists" },
  goals: { label: "Goals", moduleId: "goals" },
  problems: { label: "Problems", moduleId: "practice" },
  habits: { label: "Habits", moduleId: "habits" },
  ideas: { label: "Ideas", moduleId: "ideas" },
  dates: { label: "Dates", moduleId: "calendar" },
  subjects: { label: "Subjects", moduleId: "calendar" },
  watch: { label: "To watch", moduleId: "lists" },
  read: { label: "Books", moduleId: "lists" },
  people: { label: "People", moduleId: "debts" },
  debts: { label: "Debts", moduleId: "debts" },
  sports: { label: "Sports", moduleId: "sports" },
  fitness: { label: "Gym", moduleId: "fitness" },
  canvas: { label: "Boards", moduleId: "canvas" },
};

export function moduleOf(searchModule: string) {
  const info = SEARCH_MODULES[searchModule];
  return { info, module: modules.find((m) => m.id === info?.moduleId) };
}
