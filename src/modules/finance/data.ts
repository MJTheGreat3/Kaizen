import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, eq, isNull, lte } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { db, schema } from "@/core/db/client";
import { usePref } from "@/core/db/prefs";
import type { Account, Category, Debt, DebtPayment, MoneyKind, Person, Recurring, Transaction } from "@/core/db/schema";
import { addDaysKey, todayKey, type DateKey } from "@/lib/dates";
import { personByName } from "@/modules/debts/data";
import { balances, dueDates, movements, nextDueAfter, type Movement } from "./logic";

const a = schema.finAccounts;
const c = schema.finCategories;
const t = schema.finTransactions;
const r = schema.finRecurring;

export interface FinanceData {
  accounts: Account[];
  categories: Category[];
  txns: Transaction[];
  recurring: Recurring[];
  debts: Debt[];
  payments: DebtPayment[];
  people: Person[];
  moves: Movement[];
  balance: Map<string, number>;
}

export async function loadFinance(): Promise<FinanceData> {
  const [accounts, categories, txns, recurring, debts, payments, people] = await Promise.all([
    db.select().from(a).where(isNull(a.deletedAt)).orderBy(a.sortOrder, a.createdAt),
    db.select().from(c).where(isNull(c.deletedAt)).orderBy(c.sortOrder, c.createdAt),
    db.select().from(t).where(isNull(t.deletedAt)),
    db.select().from(r).where(isNull(r.deletedAt)).orderBy(r.nextOn),
    db.select().from(schema.debts).where(isNull(schema.debts.deletedAt)),
    db.select().from(schema.debtPayments).where(isNull(schema.debtPayments.deletedAt)),
    db.select().from(schema.people).where(isNull(schema.people.deletedAt)),
  ]);
  txns.sort((x, y) => (x.date === y.date ? y.createdAt - x.createdAt : x.date < y.date ? 1 : -1));
  const moves = movements(txns, debts, payments);
  return { accounts, categories, txns, recurring, debts, payments, people, moves, balance: balances(accounts, moves) };
}

export function useFinance() {
  return useQuery({ queryKey: ["finance"], queryFn: loadFinance });
}

/** Accounts that are still in use, and the one picked first, for other modules. */
export function useAccounts() {
  const query = useQuery({
    queryKey: ["finance", "accounts"],
    queryFn: () =>
      db
        .select()
        .from(a)
        .where(and(isNull(a.deletedAt), eq(a.archived, false)))
        .orderBy(a.sortOrder, a.createdAt),
  });
  const [preferred] = usePref("finance.defaultAccount");
  const accounts = query.data ?? [];
  const fallback = accounts.some((x) => x.id === preferred) ? preferred : (accounts[0]?.id ?? "");
  return { accounts, fallback };
}

/** Refreshes finance, debts and Today after a change to either. */
export function useMoneyMutation<A, R = unknown>(fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["finance"] });
      client.invalidateQueries({ queryKey: ["debts"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Accounts and categories
// ---------------------------------------------------------------------------

export type AccountInput = Pick<Account, "name" | "kind" | "openingPaise" | "color"> & { id?: string };

export const useSaveAccount = () =>
  useMoneyMutation(async ({ id, ...v }: AccountInput): Promise<string> => {
    if (id) {
      await db.update(a).set(v).where(eq(a.id, id));
      return id;
    }
    const [row] = await db
      .insert(a)
      .values({ ...v, sortOrder: Date.now() })
      .returning({ id: a.id });
    return row.id;
  });

export const useArchiveAccount = () =>
  useMoneyMutation(({ id, archived }: { id: string; archived: boolean }) =>
    db.update(a).set({ archived }).where(eq(a.id, id)),
  );

export const useDeleteAccount = () =>
  useMoneyMutation((id: string) => db.update(a).set({ deletedAt: Date.now() }).where(eq(a.id, id)));

export type CategoryInput = Pick<Category, "name" | "kind" | "icon" | "color" | "parentId"> & { id?: string };

export const useSaveCategory = () =>
  useMoneyMutation(async ({ id, ...v }: CategoryInput) => {
    if (id) await db.update(c).set(v).where(eq(c.id, id));
    else await db.insert(c).values({ ...v, sortOrder: Date.now() });
  });

/** Removes a category and its subcategories; transactions keep pointing at it and show as uncategorised. */
export const useDeleteCategory = () =>
  useMoneyMutation(async (id: string) => {
    const now = Date.now();
    await db.update(c).set({ deletedAt: now }).where(eq(c.id, id));
    await db
      .update(c)
      .set({ deletedAt: now })
      .where(and(eq(c.parentId, id), isNull(c.deletedAt)));
  });

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface Share {
  person: string;
  amountPaise: number;
}

export interface TxnInput {
  id?: string;
  kind: Transaction["kind"];
  amountPaise: number;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  date: DateKey;
  note: string | null;
  /** Others' shares of an expense I paid; they then owe me. */
  split: Share[];
  /** Someone else paid this expense for me; I owe them the whole amount. */
  paidBy: string | null;
}

/** Saves a transaction and replaces the debts that come from it. Returns its id. */
export async function saveTransaction(v: TxnInput, reason: string): Promise<string> {
  const id = v.id ?? uuidv7();
  const row = {
    kind: v.kind,
    amountPaise: v.amountPaise,
    accountId: v.paidBy ? null : v.accountId,
    toAccountId: v.kind === "transfer" ? v.toAccountId : null,
    categoryId: v.kind === "transfer" ? null : v.categoryId,
    date: v.date,
    note: v.note,
  };
  if (v.id) await db.update(t).set(row).where(eq(t.id, id));
  else await db.insert(t).values({ id, ...row });

  const d = schema.debts;
  await db
    .update(d)
    .set({ deletedAt: Date.now() })
    .where(and(eq(d.txnId, id), isNull(d.deletedAt)));
  if (v.kind !== "expense") return id;
  const shares = v.paidBy
    ? [{ person: v.paidBy, amountPaise: v.amountPaise }]
    : v.split.filter((s) => s.person.trim() && s.amountPaise > 0);
  for (const s of shares) {
    await db.insert(d).values({
      personId: await personByName(s.person),
      direction: v.paidBy ? "i_owe" : "owed_to_me",
      amountPaise: s.amountPaise,
      occurredOn: v.date,
      reason,
      txnId: id,
    });
  }
  return id;
}

export const useSaveTransaction = () =>
  useMoneyMutation(({ v, reason }: { v: TxnInput; reason: string }) => saveTransaction(v, reason));

export const useDeleteTransaction = () =>
  useMoneyMutation(async (id: string) => {
    const now = Date.now();
    await db.update(t).set({ deletedAt: now }).where(eq(t.id, id));
    await db
      .update(schema.debts)
      .set({ deletedAt: now })
      .where(and(eq(schema.debts.txnId, id), isNull(schema.debts.deletedAt)));
  });

// ---------------------------------------------------------------------------
// Scheduled payments
// ---------------------------------------------------------------------------

export type RecurringInput = Pick<
  Recurring,
  "kind" | "name" | "amountPaise" | "accountId" | "categoryId" | "cadence" | "every" | "anchorDate" | "auto" | "note"
> & {
  id?: string;
};

export const useSaveRecurring = () =>
  useMoneyMutation(async ({ id, ...v }: RecurringInput) => {
    const today = todayKey();
    if (id) {
      const [old] = await db.select().from(r).where(eq(r.id, id));
      // A new start date restarts the schedule; otherwise it carries on.
      const nextOn =
        !old || old.anchorDate !== v.anchorDate || old.cadence !== v.cadence || old.every !== v.every
          ? v.anchorDate >= today
            ? v.anchorDate
            : nextDueAfter(v, addDaysKey(today, -1))
          : old.nextOn;
      await db
        .update(r)
        .set({ ...v, nextOn })
        .where(eq(r.id, id));
    } else {
      await db.insert(r).values({ ...v, nextOn: v.anchorDate });
    }
    await postDue(today);
  });

export const useSetRecurringActive = () =>
  useMoneyMutation(async ({ item, active }: { item: Recurring; active: boolean }) => {
    // Resuming skips the dates missed while paused.
    const nextOn = active && item.nextOn < todayKey() ? nextDueAfter(item, addDaysKey(todayKey(), -1)) : item.nextOn;
    await db.update(r).set({ active, nextOn }).where(eq(r.id, item.id));
  });

export const useDeleteRecurring = () =>
  useMoneyMutation((id: string) => db.update(r).set({ deletedAt: Date.now() }).where(eq(r.id, id)));

async function post(item: Recurring, date: DateKey) {
  await db
    .insert(t)
    .values({
      id: `rec:${item.id}:${date}`,
      kind: item.kind as MoneyKind,
      amountPaise: item.amountPaise,
      accountId: item.accountId,
      categoryId: item.categoryId,
      date,
      note: item.name,
      recurringId: item.id,
    })
    .onConflictDoNothing();
}

/** Marks the next due date of a schedule as paid (or received) now. */
export const usePayRecurring = () =>
  useMoneyMutation(async (item: Recurring) => {
    await post(item, item.nextOn);
    await db
      .update(r)
      .set({ nextOn: nextDueAfter(item, item.nextOn) })
      .where(eq(r.id, item.id));
  });

/** Skips the next due date without posting anything. */
export const useSkipRecurring = () =>
  useMoneyMutation((item: Recurring) =>
    db
      .update(r)
      .set({ nextOn: nextDueAfter(item, item.nextOn) })
      .where(eq(r.id, item.id)),
  );

/**
 * Posts every automatic schedule that has come due, once per date (the
 * transaction id is derived from the schedule and the date, so two devices
 * doing this agree). Returns how many were posted.
 */
export async function postDue(today = todayKey()): Promise<number> {
  const due = await db
    .select()
    .from(r)
    .where(and(isNull(r.deletedAt), eq(r.active, true), eq(r.auto, true), lte(r.nextOn, today)));
  let count = 0;
  for (const item of due) {
    const dates = dueDates(item, today);
    for (const date of dates) await post(item, date);
    count += dates.length;
    if (dates.length)
      await db
        .update(r)
        .set({ nextOn: nextDueAfter(item, dates.at(-1)!) })
        .where(eq(r.id, item.id));
  }
  return count;
}

/** Posts due subscriptions and allowances when Kaizen opens or comes back to the front. */
export function useFinanceSchedule(unlocked: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!unlocked) return;
    const run = () => {
      if (document.visibilityState !== "visible") return;
      postDue()
        .then((n) => {
          if (n) void client.invalidateQueries({ queryKey: ["finance"] });
        })
        .catch(() => {
          // Tried again next time Kaizen comes to the front.
        });
    };
    run();
    document.addEventListener("visibilitychange", run);
    return () => document.removeEventListener("visibilitychange", run);
  }, [unlocked, client]);
}

/** Debts that came from transactions, by transaction id. */
export function sharesByTxn(debts: Debt[]): Map<string, Debt[]> {
  const out = new Map<string, Debt[]>();
  for (const d of debts) if (d.txnId) out.set(d.txnId, [...(out.get(d.txnId) ?? []), d]);
  return out;
}
