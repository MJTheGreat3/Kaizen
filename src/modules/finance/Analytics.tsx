import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { CaretDown, Lightbulb, PushPin, Sparkle, WarningCircle } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { usePref } from "@/core/db/prefs";
import { addDaysKey, fromKey, todayKey } from "@/lib/dates";
import { ease } from "@/lib/motion";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { BarChart, LineChart } from "@/modules/fitness/Charts";
import type { FinanceData } from "./data";
import {
  balanceSeries,
  byCategory,
  daysInMonth,
  flows,
  inMonth,
  insights,
  monthLabel,
  perMonth,
  shiftMonth,
  sum,
  type MonthKey,
} from "./logic";
import { compact } from "./format";
import { AccountIcon, BAD, CatIcon, GOOD } from "./parts";

function Tile({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="border-border bg-surface shadow-soft rounded-2xl border p-4">
      <p className="text-muted-foreground text-[12px] font-medium">{label}</p>
      <p className="mt-1 truncate text-[20px] font-semibold tracking-tight" style={{ color }}>
        {value}
      </p>
      {sub ? <p className="text-muted-foreground mt-0.5 truncate text-[12px]">{sub}</p> : null}
    </div>
  );
}

function Card({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("border-border bg-surface shadow-soft rounded-2xl border p-4 md:p-5", className)}>
      <h3 className="mb-3 text-[15px] font-semibold tracking-tight">{title}</h3>
      {children}
    </section>
  );
}

/** Swipe between all accounts and each account; any page can be where Finance opens. */
export function Analytics({ data, month, hue }: { data: FinanceData; month: MonthKey; hue: string }) {
  const [home, setHome] = usePref("finance.home");
  const pages = useMemo(
    () => [
      { id: "all", name: "All accounts" },
      ...data.accounts.filter((a) => !a.archived).map((a) => ({ id: a.id, name: a.name })),
    ],
    [data.accounts],
  );
  const start = Math.max(
    0,
    pages.findIndex((p) => p.id === home.scope),
  );
  const [index, setIndex] = useState(start);
  const track = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  // Opens on the default page once its width is known.
  useEffect(() => {
    const el = track.current;
    if (!el || placed.current) return;
    placed.current = true;
    el.scrollTo({ left: start * el.clientWidth, behavior: "instant" as ScrollBehavior });
  }, [start]);

  const go = (i: number) => track.current?.scrollTo({ left: i * track.current.clientWidth, behavior: "smooth" });
  const current = pages[Math.min(index, pages.length - 1)];
  const isHome = home.tab === "analytics" && home.scope === current.id;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-2">
        <div className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => go(i)}
              className={cn(
                "h-8 shrink-0 rounded-full border px-3 text-[13px] font-medium transition-colors",
                i === index
                  ? "bg-foreground text-background border-transparent"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {p.name}
            </button>
          ))}
        </div>
        <Button
          variant={isHome ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={isHome}
          onClick={async () => {
            await setHome(isHome ? { tab: "overview", scope: "all" } : { tab: "analytics", scope: current.id });
            toast.success(isHome ? "Finance opens on Overview again" : `Finance opens on ${current.name} analytics`);
          }}
        >
          <PushPin weight={isHome ? "fill" : "regular"} />
          <span className="hidden sm:inline">{isHome ? "Default" : "Make default"}</span>
        </Button>
      </div>
      <div
        ref={track}
        data-no-pull
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="-mx-1 flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:hidden"
      >
        {pages.map((p, i) => (
          <div key={p.id} className="w-full shrink-0 snap-start px-1">
            {Math.abs(i - index) <= 1 ? (
              <ScopePage data={data} scope={p.id} month={month} hue={hue} />
            ) : (
              <div className="h-96" />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-center gap-1.5" aria-hidden>
        {pages.map((p, i) => (
          <span
            key={p.id}
            className={cn("h-1.5 rounded-full transition-all", i === index ? "bg-foreground w-4" : "bg-border w-1.5")}
          />
        ))}
      </div>
    </div>
  );
}

function ScopePage({ data, scope, month, hue }: { data: FinanceData; scope: string; month: MonthKey; hue: string }) {
  const account = scope === "all" ? null : data.accounts.find((a) => a.id === scope);
  const [open, setOpen] = useState<string | null>(null);
  const today = todayKey();
  const { spends, incomes } = useMemo(
    () => flows(data.txns, data.debts, account?.id),
    [data.txns, data.debts, account?.id],
  );
  const catName = (id: string | null) => data.categories.find((c) => c.id === id)?.name ?? "Uncategorised";

  const spent = sum(inMonth(spends, month));
  const earned = sum(inMonth(incomes, month));
  const prevSpent = sum(inMonth(spends, shiftMonth(month, -1)));
  const live = data.accounts.filter((a) => !a.archived);
  const balance = account
    ? (data.balance.get(account.id) ?? 0)
    : live.reduce((s, a) => s + (data.balance.get(a.id) ?? 0), 0);
  const cats = byCategory(inMonth(spends, month), data.categories);
  const prevCats = byCategory(inMonth(spends, shiftMonth(month, -1)), data.categories);
  const maxCat = Math.max(1, ...cats.map((c) => c.amount));

  const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
  const monthBars = months.map((m) => ({
    key: m,
    label: monthLabel(m),
    value: sum(inMonth(spends, m)),
    detail: `${monthLabel(m, true)} · ${formatPaise(sum(inMonth(incomes, m)))} in`,
  }));
  const lastDay = month === today.slice(0, 7) ? Number(today.slice(8, 10)) : daysInMonth(month);
  const dayBars = Array.from({ length: daysInMonth(month) }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, "0")}`;
    return {
      key: d,
      label: String(i + 1),
      value: i < lastDay ? sum(spends.filter((s) => s.date === d)) : 0,
      detail: fromKey(d).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }),
    };
  });

  const ids = account ? [account.id] : live.map((a) => a.id);
  const moves = data.moves.filter((m) => ids.includes(m.accountId));
  const opening = (account ? [account] : live).reduce((s, a) => s + a.openingPaise, 0);
  const from = addDaysKey(today, -89);
  const series = balanceSeries(opening, moves, from, today).map((p) => ({
    at: fromKey(p.date).getTime(),
    value: p.value / 100,
  }));

  const subs = data.recurring.filter(
    (r) => r.active && r.kind === "expense" && (!account || r.accountId === account.id),
  );
  const notes = insights({
    spends,
    incomes,
    month,
    today,
    categories: data.categories,
    categoryName: catName,
    subscriptions: { perMonth: subs.reduce((s, r) => s + perMonth(r), 0), count: subs.length },
    format: formatPaise,
  });
  const biggest = [...inMonth(spends, month)].sort((a, b) => b.amount - a.amount).slice(0, 5);
  const change = prevSpent ? (spent - prevSpent) / prevSpent : null;

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3 px-1 pt-1">
        {account ? <AccountIcon account={account} size={32} /> : null}
        <h2 className="text-[17px] font-semibold tracking-tight">{account ? account.name : "All accounts"}</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Spent"
          value={formatPaise(spent)}
          sub={
            change === null
              ? undefined
              : `${change > 0 ? "+" : "−"}${Math.round(Math.abs(change) * 100)}% on ${monthLabel(shiftMonth(month, -1))}`
          }
        />
        <Tile label="Came in" value={formatPaise(earned)} color={earned ? GOOD : undefined} />
        <Tile
          label="Net"
          value={`${earned - spent < 0 ? "−" : "+"}${formatPaise(Math.abs(earned - spent))}`}
          color={earned - spent < 0 ? BAD : earned - spent > 0 ? GOOD : undefined}
        />
        <Tile label={account ? "Balance" : "Total balance"} value={formatPaise(balance)} />
      </div>

      {notes.length ? (
        <Card title="Insights">
          <ul className="grid gap-2">
            {notes.map((n) => (
              <li key={n.id} className="flex items-start gap-2.5 text-[14px] leading-snug">
                <span
                  className="mt-0.5 shrink-0"
                  style={{ color: n.tone === "good" ? GOOD : n.tone === "bad" ? BAD : "var(--muted-foreground)" }}
                >
                  {n.tone === "good" ? (
                    <Sparkle size={16} weight="fill" />
                  ) : n.tone === "bad" ? (
                    <WarningCircle size={16} weight="fill" />
                  ) : (
                    <Lightbulb size={16} weight="fill" />
                  )}
                </span>
                {n.text}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Where it went">
          {cats.length ? (
            <ul className="grid gap-1">
              {cats.map((c) => {
                const cat = data.categories.find((x) => x.id === c.id);
                const before = prevCats.find((x) => x.id === c.id)?.amount ?? 0;
                const subs = [...c.children].filter(([id]) => id !== c.id).sort((x, y) => y[1] - x[1]);
                const expanded = open === (c.id ?? "none");
                return (
                  <li key={c.id ?? "none"}>
                    <button
                      type="button"
                      onClick={() => setOpen(expanded ? null : (c.id ?? "none"))}
                      className="hover:bg-surface-muted/60 grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-xl px-1.5 py-1.5 text-left"
                      title={
                        before ? `${formatPaise(before)} in ${monthLabel(shiftMonth(month, -1), true)}` : undefined
                      }
                    >
                      <CatIcon category={cat} size={32} />
                      <span className="min-w-0">
                        <span className="flex items-center gap-1 text-[14px] font-medium">
                          <span className="truncate">{cat?.name ?? "Uncategorised"}</span>
                          {subs.length ? (
                            <CaretDown
                              size={12}
                              className={cn(
                                "text-muted-foreground shrink-0 transition-transform",
                                expanded && "rotate-180",
                              )}
                            />
                          ) : null}
                        </span>
                        <span className="bg-surface-muted mt-1 block h-1.5 overflow-hidden rounded-full">
                          <motion.span
                            className="block h-full rounded-full"
                            style={{ background: hue }}
                            initial={{ width: 0 }}
                            animate={{ width: `${(c.amount / maxCat) * 100}%` }}
                            transition={{ duration: 0.5, ease }}
                          />
                        </span>
                      </span>
                      <span className="text-right">
                        <span className="block text-[14px] font-semibold tabular-nums">{formatPaise(c.amount)}</span>
                        <span className="text-muted-foreground block text-[11px] tabular-nums">
                          {Math.round((c.amount / Math.max(1, spent)) * 100)}%
                        </span>
                      </span>
                    </button>
                    {expanded && subs.length ? (
                      <ul className="mb-1 ml-12 grid gap-0.5">
                        {subs.map(([id, amount]) => (
                          <li key={id} className="text-muted-foreground flex justify-between text-[13px]">
                            <span>{catName(id)}</span>
                            <span className="tabular-nums">{formatPaise(amount)}</span>
                          </li>
                        ))}
                        {c.children.get(c.id ?? "") ? (
                          <li className="text-muted-foreground flex justify-between text-[13px]">
                            <span>Other {cat?.name.toLowerCase()}</span>
                            <span className="tabular-nums">{formatPaise(c.children.get(c.id ?? "")!)}</span>
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-[13px]">
              Nothing spent in {monthLabel(month, true)}.
            </p>
          )}
        </Card>

        <div className="grid gap-3">
          <Card title="Spent each month">
            <BarChart
              bars={monthBars}
              color={hue}
              format={compact}
              label="Spending per month, last six months"
              empty="Nothing spent in the last six months."
            />
          </Card>
          <Card title={`Day by day, ${monthLabel(month, true)}`}>
            <BarChart
              bars={dayBars}
              color={hue}
              format={compact}
              label="Spending per day"
              empty="Nothing spent this month."
            />
          </Card>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Balance, last 90 days">
          <LineChart
            points={series}
            color={hue}
            format={(v) => compact(v * 100)}
            label="Balance over the last 90 days"
          />
        </Card>
        <Card title="Biggest expenses">
          {biggest.length ? (
            <ul className="grid gap-2">
              {biggest.map((s) => (
                <li key={s.id} className="flex items-center gap-3 text-[14px]">
                  <CatIcon category={data.categories.find((c) => c.id === s.categoryId)} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.note || catName(s.categoryId)}</span>
                    <span className="text-muted-foreground text-[12px]">
                      {fromKey(s.date).toLocaleDateString([], { day: "numeric", month: "short" })}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatPaise(s.amount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground py-8 text-center text-[13px]">Nothing yet.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
