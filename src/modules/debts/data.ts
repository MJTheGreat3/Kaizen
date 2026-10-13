import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { eq, isNull } from "drizzle-orm";

import { db, schema } from "@/core/db/client";
import type { Debt, DebtPayment, Person } from "@/core/db/schema";
import { balances, findPerson } from "./balances";

export interface DebtsData {
  people: Person[];
  debts: Debt[];
  payments: DebtPayment[];
  balance: Map<string, number>;
}

export async function loadDebts(): Promise<DebtsData> {
  const [people, debts, payments] = await Promise.all([
    db.select().from(schema.people).where(isNull(schema.people.deletedAt)),
    db.select().from(schema.debts).where(isNull(schema.debts.deletedAt)),
    db.select().from(schema.debtPayments).where(isNull(schema.debtPayments.deletedAt)),
  ]);
  return { people, debts, payments, balance: balances(debts, payments) };
}

export function useDebts() {
  return useQuery({ queryKey: ["debts"], queryFn: loadDebts });
}

function useDebtMutation<A>(fn: (arg: A) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["debts"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/** Finds a person by name (case-insensitive) or creates them. */
export async function personByName(name: string): Promise<string> {
  const people = await db.select().from(schema.people).where(isNull(schema.people.deletedAt));
  const existing = findPerson(people, name);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.people).values({ name: name.trim() }).returning({ id: schema.people.id });
  return created.id;
}

export interface NewDebt {
  person: string;
  direction: Debt["direction"];
  amountPaise: number;
  occurredOn: string;
  reason: string | null;
  dueOn?: string | null;
}

export function useAddDebt() {
  return useDebtMutation(async (d: NewDebt) => {
    const personId = await personByName(d.person);
    await db.insert(schema.debts).values({
      personId,
      direction: d.direction,
      amountPaise: d.amountPaise,
      occurredOn: d.occurredOn,
      reason: d.reason,
      dueOn: d.dueOn ?? null,
    });
  });
}

export interface NewPayment {
  person: string;
  direction: DebtPayment["direction"];
  amountPaise: number;
  paidOn: string;
  note: string | null;
}

export function useAddPayment() {
  return useDebtMutation(async (p: NewPayment) => {
    const personId = await personByName(p.person);
    await db.insert(schema.debtPayments).values({
      personId,
      direction: p.direction,
      amountPaise: p.amountPaise,
      paidOn: p.paidOn,
      note: p.note,
    });
  });
}

/** Adds several IOUs at once (bill splitting). */
export function useAddMany() {
  return useDebtMutation(async (items: NewDebt[]) => {
    for (const d of items) {
      const personId = await personByName(d.person);
      await db.insert(schema.debts).values({
        personId,
        direction: d.direction,
        amountPaise: d.amountPaise,
        occurredOn: d.occurredOn,
        reason: d.reason,
      });
    }
  });
}

export function useDeleteEntry() {
  return useDebtMutation(async ({ kind, id }: { kind: "debt" | "payment"; id: string }) => {
    const table = kind === "debt" ? schema.debts : schema.debtPayments;
    await db.update(table).set({ deletedAt: Date.now() }).where(eq(table.id, id));
  });
}

export function useUpdatePerson() {
  return useDebtMutation(({ id, ...patch }: Partial<Person> & { id: string }) =>
    db.update(schema.people).set(patch).where(eq(schema.people.id, id)),
  );
}
