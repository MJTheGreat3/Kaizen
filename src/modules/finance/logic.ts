/**
 * Pure money maths. Amounts are paise.
 *
 * An account's balance is its opening amount plus everything that moved
 * money in or out of it: income, expenses (the full bill, even when split),
 * transfers, and debts or repayments made through it. What I spent is
 * different: a split expense counts only my share (the bill less what
 * others owe me for it).
 */
import type { Cadence, Category, Debt, DebtPayment, Recurring, Transaction } from "@/core/db/schema";
import { addDaysKey, daysBetween, fromKey, isoWeekday, type DateKey } from "@/lib/dates";

type Txn = Pick<
  Transaction,
  "id" | "kind" | "amountPaise" | "accountId" | "toAccountId" | "categoryId" | "date" | "note"
>;
type DebtLike = Pick<Debt, "direction" | "amountPaise" | "occurredOn" | "accountId" | "txnId">;
type PaymentLike = Pick<DebtPayment, "direction" | "amountPaise" | "paidOn" | "accountId">;

export interface Movement {
  accountId: string;
  date: DateKey;
  /** Positive into the account. */
  delta: number;
}

/** Every change to an account's balance. */
export function movements(txns: Txn[], debts: DebtLike[], payments: PaymentLike[]): Movement[] {
  const out: Movement[] = [];
  for (const t of txns) {
    if (!t.accountId) continue;
    if (t.kind === "income") out.push({ accountId: t.accountId, date: t.date, delta: t.amountPaise });
    else if (t.kind === "expense") out.push({ accountId: t.accountId, date: t.date, delta: -t.amountPaise });
    else {
      out.push({ accountId: t.accountId, date: t.date, delta: -t.amountPaise });
      if (t.toAccountId) out.push({ accountId: t.toAccountId, date: t.date, delta: t.amountPaise });
    }
  }
  // Shares of an expense moved no money themselves; the expense did.
  for (const d of debts) {
    if (!d.accountId || d.txnId) continue;
    out.push({
      accountId: d.accountId,
      date: d.occurredOn,
      delta: d.direction === "owed_to_me" ? -d.amountPaise : d.amountPaise,
    });
  }
  for (const p of payments) {
    if (!p.accountId) continue;
    out.push({
      accountId: p.accountId,
      date: p.paidOn,
      delta: p.direction === "to_me" ? p.amountPaise : -p.amountPaise,
    });
  }
  return out;
}

export function balances(accounts: { id: string; openingPaise: number }[], moves: Movement[]): Map<string, number> {
  const out = new Map(accounts.map((a) => [a.id, a.openingPaise]));
  for (const m of moves) if (out.has(m.accountId)) out.set(m.accountId, out.get(m.accountId)! + m.delta);
  return out;
}

/** End-of-day balance for each day from `from` to `to`, over the given accounts. */
export function balanceSeries(
  opening: number,
  moves: Movement[],
  from: DateKey,
  to: DateKey,
): { date: DateKey; value: number }[] {
  let running = opening;
  const byDay = new Map<DateKey, number>();
  for (const m of moves) {
    if (m.date < from) running += m.delta;
    else if (m.date <= to) byDay.set(m.date, (byDay.get(m.date) ?? 0) + m.delta);
  }
  const out: { date: DateKey; value: number }[] = [];
  for (let d = from; d <= to; d = addDaysKey(d, 1)) {
    running += byDay.get(d) ?? 0;
    out.push({ date: d, value: running });
  }
  return out;
}

/** Others' shares of each expense, by transaction id. */
export function othersShares(debts: DebtLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of debts)
    if (d.txnId && d.direction === "owed_to_me") out.set(d.txnId, (out.get(d.txnId) ?? 0) + d.amountPaise);
  return out;
}

export interface Spend {
  id: string;
  date: DateKey;
  /** My share. */
  amount: number;
  categoryId: string | null;
  accountId: string | null;
  note: string | null;
}

/** Expenses at my share, and income, optionally for one account. */
export function flows(txns: Txn[], debts: DebtLike[], accountId?: string) {
  const others = othersShares(debts);
  const spends: Spend[] = [];
  const incomes: Spend[] = [];
  for (const t of txns) {
    if (accountId && t.accountId !== accountId) continue;
    const row = { id: t.id, date: t.date, categoryId: t.categoryId, accountId: t.accountId, note: t.note };
    if (t.kind === "expense") {
      const amount = Math.max(0, t.amountPaise - (others.get(t.id) ?? 0));
      if (amount) spends.push({ ...row, amount });
    } else if (t.kind === "income") incomes.push({ ...row, amount: t.amountPaise });
  }
  return { spends, incomes };
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

export type MonthKey = string; // YYYY-MM

export const monthOf = (d: DateKey): MonthKey => d.slice(0, 7);

export function shiftMonth(m: MonthKey, n: number): MonthKey {
  const [y, mo] = m.split("-").map(Number);
  const i = y * 12 + (mo - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export function daysInMonth(m: MonthKey): number {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo, 0).getDate();
}

export const monthLabel = (m: MonthKey, long = false) =>
  fromKey(`${m}-01`).toLocaleDateString([], { month: long ? "long" : "short", year: long ? "numeric" : undefined });

export const sum = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);
export const inMonth = <T extends { date: DateKey }>(rows: T[], m: MonthKey) =>
  rows.filter((r) => r.date.startsWith(m));

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

type CategoryLike = Pick<Category, "id" | "parentId">;

/** The top-level category a (sub)category belongs to. */
export function topOf(categories: CategoryLike[], id: string | null): string | null {
  if (!id) return null;
  const c = categories.find((x) => x.id === id);
  return c?.parentId ?? id;
}

export interface CategoryTotal {
  id: string | null;
  amount: number;
  /** Subcategory totals (and the parent's own spends under its id). */
  children: Map<string, number>;
}

export function byCategory(rows: Spend[], categories: CategoryLike[]): CategoryTotal[] {
  const out = new Map<string | null, CategoryTotal>();
  for (const r of rows) {
    const top = topOf(categories, r.categoryId);
    const entry = out.get(top) ?? { id: top, amount: 0, children: new Map() };
    entry.amount += r.amount;
    if (r.categoryId) entry.children.set(r.categoryId, (entry.children.get(r.categoryId) ?? 0) + r.amount);
    out.set(top, entry);
  }
  return [...out.values()].sort((a, b) => b.amount - a.amount);
}

// ---------------------------------------------------------------------------
// Schedules (subscriptions and allowances)
// ---------------------------------------------------------------------------

/** The `n`th due date from the anchor, keeping its day of the month (clamped to short months). */
export function nthDue(anchor: DateKey, cadence: Cadence, every: number, n: number): DateKey {
  if (cadence === "weekly") return addDaysKey(anchor, 7 * every * n);
  const months = cadence === "monthly" ? every * n : 12 * every * n;
  const m = shiftMonth(monthOf(anchor), months);
  const day = Math.min(Number(anchor.slice(8, 10)), daysInMonth(m));
  return `${m}-${String(day).padStart(2, "0")}`;
}

/** The first due date after `after`. */
export function nextDueAfter(r: Pick<Recurring, "anchorDate" | "cadence" | "every">, after: DateKey): DateKey {
  if (r.anchorDate > after) return r.anchorDate;
  const step = r.cadence === "weekly" ? 7 * r.every : r.cadence === "monthly" ? 30 * r.every : 365 * r.every;
  let n = Math.max(0, Math.floor(daysBetween(r.anchorDate, after) / step) - 1);
  while (nthDue(r.anchorDate, r.cadence, r.every, n) <= after) n++;
  return nthDue(r.anchorDate, r.cadence, r.every, n);
}

/** Due dates from `nextOn` up to and including `upTo`. */
export function dueDates(
  r: Pick<Recurring, "anchorDate" | "cadence" | "every" | "nextOn">,
  upTo: DateKey,
  limit = 60,
): DateKey[] {
  const out: DateKey[] = [];
  let d = r.nextOn;
  while (d <= upTo && out.length < limit) {
    out.push(d);
    d = nextDueAfter(r, d);
  }
  return out;
}

/** What a schedule comes to per month. */
export function perMonth(r: Pick<Recurring, "amountPaise" | "cadence" | "every">): number {
  const per =
    r.cadence === "weekly" ? (r.amountPaise * 52) / 12 : r.cadence === "monthly" ? r.amountPaise : r.amountPaise / 12;
  return Math.round(per / r.every);
}

export const cadenceLabel = (cadence: Cadence, every: number) =>
  every === 1
    ? { weekly: "Every week", monthly: "Every month", yearly: "Every year" }[cadence]
    : `Every ${every} ${{ weekly: "weeks", monthly: "months", yearly: "years" }[cadence]}`;

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface Insight {
  id: string;
  text: string;
  /** good: in your favour; bad: worth a look. */
  tone: "good" | "bad" | "neutral";
}

const pct = (n: number) => `${Math.round(Math.abs(n) * 100)}%`;

/**
 * Observations about one month's money. `today` limits the pace comparison
 * to the same day of last month while the month is still running.
 */
export function insights(args: {
  spends: Spend[];
  incomes: Spend[];
  month: MonthKey;
  today: DateKey;
  categories: CategoryLike[];
  categoryName: (id: string | null) => string;
  /** Monthly cost of active scheduled expenses, and how many there are. */
  subscriptions: { perMonth: number; count: number };
  format: (paise: number) => string;
}): Insight[] {
  const { spends, incomes, month, today, categoryName, subscriptions, format, categories } = args;
  const out: Insight[] = [];
  const current = inMonth(spends, month);
  const spent = sum(current);
  const running = monthOf(today) === month;
  const day = running ? Number(today.slice(8, 10)) : daysInMonth(month);
  const prev = shiftMonth(month, -1);
  const prevByDay = inMonth(spends, prev).filter((s) => Number(s.date.slice(8, 10)) <= day);
  const prevSpent = sum(prevByDay);

  if (spent && prevSpent) {
    const change = (spent - prevSpent) / prevSpent;
    if (Math.abs(change) >= 0.1) {
      out.push({
        id: "pace",
        text: running
          ? `${format(spent)} so far, ${pct(change)} ${change > 0 ? "more" : "less"} than by this day last month.`
          : `${pct(change)} ${change > 0 ? "more" : "less"} spent than the month before.`,
        tone: change > 0 ? "bad" : "good",
      });
    }
  }
  if (running && spent && day < daysInMonth(month) && day >= 5) {
    out.push({
      id: "projection",
      text: `At this rate the month ends around ${format(Math.round((spent / day) * daysInMonth(month)))}.`,
      tone: "neutral",
    });
  }

  const cats = byCategory(current, categories);
  if (cats.length > 1 && spent) {
    const top = cats[0];
    out.push({
      id: "top",
      text: `${categoryName(top.id)} is ${pct(top.amount / spent)} of your spending.`,
      tone: "neutral",
    });
  }
  // A category well above its usual (the three months before).
  const history = [1, 2, 3].map((n) => byCategory(inMonth(spends, shiftMonth(month, -n)), categories));
  let rise: { id: string | null; by: number; amount: number } | null = null;
  for (const c of cats) {
    const usual = history.reduce((s, h) => s + (h.find((x) => x.id === c.id)?.amount ?? 0), 0) / 3;
    if (usual < 10_000 || c.amount - usual < 50_000) continue;
    const by = (c.amount - usual) / usual;
    if (by >= 0.3 && (!rise || by > rise.by)) rise = { id: c.id, by, amount: c.amount - usual };
  }
  if (rise)
    out.push({
      id: "rise",
      text: `${categoryName(rise.id)} is up ${pct(rise.by)} on your usual month (${format(rise.amount)} more).`,
      tone: "bad",
    });

  const earned = sum(inMonth(incomes, month));
  if (earned && spent) {
    const kept = (earned - spent) / earned;
    out.push(
      kept >= 0
        ? { id: "kept", text: `You kept ${pct(kept)} of what came in (${format(earned - spent)}).`, tone: "good" }
        : { id: "kept", text: `You spent ${format(spent - earned)} more than came in.`, tone: "bad" },
    );
  }

  const biggest = current.reduce<Spend | null>((b, s) => (!b || s.amount > b.amount ? s : b), null);
  if (biggest && current.length > 2) {
    out.push({
      id: "biggest",
      text: `Biggest: ${format(biggest.amount)} on ${biggest.note || categoryName(biggest.categoryId)}, ${fromKey(biggest.date).toLocaleDateString([], { day: "numeric", month: "short" })}.`,
      tone: "neutral",
    });
  }

  // Weekends against weekdays, per day, over the days so far.
  if (current.length >= 5) {
    let weekend = 0;
    let weekday = 0;
    let weekendDays = 0;
    let weekdayDays = 0;
    for (let d = 1; d <= day; d++) {
      const key = `${month}-${String(d).padStart(2, "0")}`;
      const amount = sum(current.filter((s) => s.date === key));
      if (isoWeekday(key) >= 6) {
        weekend += amount;
        weekendDays++;
      } else {
        weekday += amount;
        weekdayDays++;
      }
    }
    const a = weekendDays ? weekend / weekendDays : 0;
    const b = weekdayDays ? weekday / weekdayDays : 0;
    if (a && b && a / b >= 1.5)
      out.push({ id: "weekend", text: `You spend ${(a / b).toFixed(1)}× as much a day at weekends.`, tone: "neutral" });
  }

  const spendDays = new Set(current.map((s) => s.date)).size;
  if (day >= 7 && day - spendDays >= 3)
    out.push({ id: "no-spend", text: `${day - spendDays} days without spending anything.`, tone: "good" });

  if (subscriptions.count) {
    out.push({
      id: "subscriptions",
      text: `${subscriptions.count} ${subscriptions.count === 1 ? "subscription costs" : "subscriptions cost"} ${format(subscriptions.perMonth)} a month.`,
      tone: "neutral",
    });
  }
  return out;
}
