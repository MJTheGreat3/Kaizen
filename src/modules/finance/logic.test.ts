import { describe, expect, it } from "vitest";

import {
  balances,
  balanceSeries,
  byCategory,
  dueDates,
  flows,
  insights,
  movements,
  nextDueAfter,
  nthDue,
  perMonth,
  shiftMonth,
} from "./logic";

const txn = (t: Partial<Parameters<typeof movements>[0][number]> & { id: string }) => ({
  kind: "expense" as const,
  amountPaise: 0,
  accountId: "bank",
  toAccountId: null,
  categoryId: null,
  date: "2026-10-01",
  note: null,
  ...t,
});

describe("balances", () => {
  const txns = [
    txn({ id: "pay", kind: "income", amountPaise: 50_000_00 }),
    txn({ id: "dinner", amountPaise: 1_200_00, categoryId: "cat:eating-out" }),
    txn({ id: "atm", kind: "transfer", amountPaise: 2_000_00, toAccountId: "cash" }),
    txn({ id: "treat", amountPaise: 300_00, accountId: null }),
  ];
  const debts = [
    // Rahul and Priya owe their shares of dinner.
    {
      direction: "owed_to_me" as const,
      amountPaise: 400_00,
      occurredOn: "2026-10-01",
      accountId: null,
      txnId: "dinner",
    },
    {
      direction: "owed_to_me" as const,
      amountPaise: 400_00,
      occurredOn: "2026-10-01",
      accountId: null,
      txnId: "dinner",
    },
    // Aman paid for my treat.
    { direction: "i_owe" as const, amountPaise: 300_00, occurredOn: "2026-10-01", accountId: null, txnId: "treat" },
    // Cash lent straight from the wallet.
    { direction: "owed_to_me" as const, amountPaise: 500_00, occurredOn: "2026-10-02", accountId: "cash", txnId: null },
  ];
  const payments = [{ direction: "to_me" as const, amountPaise: 400_00, paidOn: "2026-10-03", accountId: "bank" }];

  it("follows the money actually in each account", () => {
    const b = balances(
      [
        { id: "bank", openingPaise: 10_000_00 },
        { id: "cash", openingPaise: 0 },
      ],
      movements(txns, debts, payments),
    );
    // 10,000 + 50,000 - 1,200 (whole bill) - 2,000 + 400 (Rahul paid back)
    expect(b.get("bank")).toBe(57_200_00);
    expect(b.get("cash")).toBe(1_500_00);
  });

  it("counts only my share of a split", () => {
    const { spends, incomes } = flows(txns, debts);
    expect(spends.map((s) => [s.id, s.amount])).toEqual([
      ["dinner", 400_00],
      ["treat", 300_00],
    ]);
    expect(incomes[0].amount).toBe(50_000_00);
    expect(flows(txns, debts, "cash").spends).toEqual([]);
  });

  it("draws a running balance", () => {
    const series = balanceSeries(
      100,
      [
        { accountId: "a", date: "2026-10-02", delta: 50 },
        { accountId: "a", date: "2026-09-30", delta: 10 },
      ],
      "2026-10-01",
      "2026-10-03",
    );
    expect(series.map((p) => p.value)).toEqual([110, 160, 160]);
  });
});

describe("categories", () => {
  it("rolls subcategories up to their parent", () => {
    const cats = [
      { id: "cat:food", parentId: null },
      { id: "cat:eating-out", parentId: "cat:food" },
      { id: "cat:travel", parentId: null },
    ];
    const rows = [
      { id: "1", date: "2026-10-01", amount: 300, categoryId: "cat:eating-out", accountId: null, note: null },
      { id: "2", date: "2026-10-01", amount: 200, categoryId: "cat:food", accountId: null, note: null },
      { id: "3", date: "2026-10-01", amount: 400, categoryId: "cat:travel", accountId: null, note: null },
    ];
    const totals = byCategory(rows, cats);
    expect(totals.map((t) => [t.id, t.amount])).toEqual([
      ["cat:food", 500],
      ["cat:travel", 400],
    ]);
    expect(totals[0].children.get("cat:eating-out")).toBe(300);
  });
});

describe("schedules", () => {
  it("keeps the day of the month, clamped in short months", () => {
    expect(nthDue("2026-01-31", "monthly", 1, 1)).toBe("2026-02-28");
    expect(nthDue("2026-01-31", "monthly", 1, 2)).toBe("2026-03-31");
    expect(nthDue("2026-10-05", "weekly", 2, 1)).toBe("2026-10-19");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("finds the next and the overdue due dates", () => {
    const r = { anchorDate: "2026-01-31", cadence: "monthly" as const, every: 1 };
    expect(nextDueAfter(r, "2026-02-28")).toBe("2026-03-31");
    expect(nextDueAfter(r, "2026-01-01")).toBe("2026-01-31");
    expect(dueDates({ ...r, nextOn: "2026-08-31" }, "2026-10-17")).toEqual(["2026-08-31", "2026-09-30"]);
    expect(perMonth({ amountPaise: 1200_00, cadence: "yearly", every: 1 })).toBe(100_00);
  });
});

describe("insights", () => {
  it("notices pace, the top category and what was kept", () => {
    const spend = (date: string, amount: number, categoryId = "cat:food") => ({
      id: date + amount,
      date,
      amount,
      categoryId,
      accountId: null,
      note: null,
    });
    const list = insights({
      spends: [spend("2026-09-03", 1_000_00), spend("2026-10-02", 2_000_00), spend("2026-10-05", 500_00, "cat:travel")],
      incomes: [{ id: "i", date: "2026-10-01", amount: 10_000_00, categoryId: null, accountId: null, note: null }],
      month: "2026-10",
      today: "2026-10-10",
      categories: [],
      categoryName: (id) => (id === "cat:food" ? "Food" : "Travel"),
      subscriptions: { perMonth: 0, count: 0 },
      format: (p) => `₹${p / 100}`,
    });
    const text = Object.fromEntries(list.map((i) => [i.id, i.text]));
    expect(text.pace).toBe("₹2500 so far, 150% more than by this day last month.");
    expect(text.top).toBe("Food is 80% of your spending.");
    expect(text.kept).toBe("You kept 75% of what came in (₹7500).");
  });
});
