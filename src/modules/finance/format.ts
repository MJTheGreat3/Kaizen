import type { Category } from "@/core/db/schema";

/** "Food › Eating out", or just the name for a top-level category. */
export function categoryLabel(
  categories: Category[],
  id: string | null | undefined,
  fallback = "Uncategorised",
): string {
  const cat = id ? categories.find((c) => c.id === id) : undefined;
  if (!cat) return fallback;
  const parent = cat.parentId ? categories.find((c) => c.id === cat.parentId) : undefined;
  return parent ? `${parent.name} › ${cat.name}` : cat.name;
}

/** ₹1.2k, ₹45k, ₹1.3L for axes. */
export function compact(paise: number) {
  const r = paise / 100;
  const a = Math.abs(r);
  const s =
    a >= 1e5
      ? `${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`
      : a >= 1000
        ? `${(a / 1000).toFixed(a >= 1e4 ? 0 : 1)}k`
        : String(Math.round(a));
  return `${r < 0 ? "−" : ""}₹${s.replace(".0", "")}`;
}
