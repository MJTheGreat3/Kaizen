import type { Debt, DebtPayment, Person } from "@/core/db/schema";

type DebtLike = Pick<Debt, "personId" | "direction" | "amountPaise">;
type PaymentLike = Pick<DebtPayment, "personId" | "direction" | "amountPaise">;

/**
 * Net balance per person in paise. Positive: they owe me. Negative: I owe
 * them. Repayments move the balance towards zero.
 */
export function balances(debts: DebtLike[], payments: PaymentLike[]): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, delta: number) => out.set(id, (out.get(id) ?? 0) + delta);
  for (const d of debts) add(d.personId, d.direction === "owed_to_me" ? d.amountPaise : -d.amountPaise);
  for (const p of payments) add(p.personId, p.direction === "to_me" ? -p.amountPaise : p.amountPaise);
  return out;
}

export interface Totals {
  owedToMe: number;
  iOwe: number;
  net: number;
}

export function totals(byPerson: Map<string, number>): Totals {
  let owedToMe = 0;
  let iOwe = 0;
  for (const v of byPerson.values()) {
    if (v > 0) owedToMe += v;
    else iOwe -= v;
  }
  return { owedToMe, iOwe, net: owedToMe - iOwe };
}

/** Splits a bill as evenly as possible, giving leftover paise to the first people. */
export function splitEvenly(totalPaise: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(totalPaise / count);
  const extra = totalPaise - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Case-insensitive person lookup by name. */
export function findPerson(people: Person[], name: string): Person | undefined {
  const n = name.trim().toLowerCase();
  return people.find((p) => p.name.trim().toLowerCase() === n);
}

/** A friendly reminder message for the share sheet. */
export function nudgeMessage(name: string, amount: string, reasons: string[]): string {
  const forWhat = reasons.length ? ` (${reasons.slice(0, 3).join(", ")})` : "";
  return `Hey ${name}, just a gentle reminder about the ${amount}${forWhat}. No rush, whenever you can. Thanks!`;
}
