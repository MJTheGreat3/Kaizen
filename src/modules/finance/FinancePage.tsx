import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  CheckCircle,
  MagnifyingGlass,
  Pause,
  PencilSimple,
  Play,
  Plus,
  PushPin,
  Repeat,
  SkipForward,
  Tag,
  Wallet,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Skeleton } from "@/components/ui/controls";
import { Input } from "@/components/ui/input";
import { EmptyState, RowMenu, SectionTitle } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import type { Account, MoneyKind, Recurring, Transaction } from "@/core/db/schema";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { useOpenTarget } from "@/core/shell/openRequest";
import { daysBetween, relativeDay, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { balances as debtBalances, totals } from "@/modules/debts/balances";
import { modules, pathOf } from "@/modules/registry";
import { Analytics } from "./Analytics";
import {
  sharesByTxn,
  useFinance,
  usePayRecurring,
  useSetRecurringActive,
  useSkipRecurring,
  type FinanceData,
} from "./data";
import { AccountDialog, CategoriesDialog, RecurringDialog } from "./Dialogs";
import {
  cadenceLabel,
  flows,
  inMonth,
  monthLabel,
  othersShares,
  perMonth,
  shiftMonth,
  sum,
  type MonthKey,
} from "./logic";
import { AccountIcon, CatIcon, GOOD, Money } from "./parts";
import { categoryLabel } from "./format";
import { TransactionDialog, type TxnDraft } from "./TransactionDialog";

const mod = modules.find((m) => m.id === "finance")!;
const HUE = mod.hue;

type Tab = "overview" | "transactions" | "analytics" | "scheduled";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "transactions", label: "Transactions" },
  { value: "analytics", label: "Analytics" },
  { value: "scheduled", label: "Scheduled" },
];

function MonthStepper({ month, onChange }: { month: MonthKey; onChange: (m: MonthKey) => void }) {
  const current = todayKey().slice(0, 7);
  return (
    <div className="border-border bg-surface shadow-soft inline-flex h-9 items-center rounded-lg border">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
        className="text-muted-foreground hover:text-foreground grid h-full w-9 place-items-center"
      >
        <CaretLeft size={14} weight="bold" />
      </button>
      <button type="button" onClick={() => onChange(current)} className="min-w-28 text-center text-[13px] font-medium">
        {monthLabel(month, true)}
      </button>
      <button
        type="button"
        aria-label="Next month"
        disabled={month >= current}
        onClick={() => onChange(shiftMonth(month, 1))}
        className="text-muted-foreground hover:text-foreground grid h-full w-9 place-items-center disabled:opacity-30"
      >
        <CaretRight size={14} weight="bold" />
      </button>
    </div>
  );
}

/** One transaction: what, where from, and the money (with my share when split). */
function TxnRow({ txn, data, onOpen }: { txn: Transaction; data: FinanceData; onOpen: (t: Transaction) => void }) {
  const cat = data.categories.find((c) => c.id === txn.categoryId);
  const account = data.accounts.find((a) => a.id === txn.accountId);
  const to = data.accounts.find((a) => a.id === txn.toAccountId);
  const shares = sharesByTxn(data.debts).get(txn.id) ?? [];
  const others = shares.filter((d) => d.direction === "owed_to_me").reduce((s, d) => s + d.amountPaise, 0);
  const paidBy = shares.find((d) => d.direction === "i_owe");
  const who = paidBy ? data.people.find((p) => p.id === paidBy.personId)?.name : null;
  const title =
    txn.kind === "transfer" ? txn.note || "Transfer" : txn.note || categoryLabel(data.categories, txn.categoryId);
  const sub =
    txn.kind === "transfer"
      ? `${account?.name ?? "?"} → ${to?.name ?? "?"}`
      : [
          txn.note ? categoryLabel(data.categories, txn.categoryId) : null,
          who ? `paid by ${who}` : account?.name,
          txn.recurringId ? "scheduled" : null,
        ]
          .filter(Boolean)
          .join(" · ");
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(txn)}
        className="hover:bg-surface-muted/70 flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors"
      >
        {txn.kind === "transfer" ? (
          <span className="bg-surface-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-xl">
            <ArrowsLeftRight size={18} />
          </span>
        ) : (
          <CatIcon category={cat} />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{title}</span>
          <span className="text-muted-foreground block truncate text-[12px]">{sub}</span>
        </span>
        <span className="text-right">
          <Money
            paise={txn.amountPaise}
            sign={txn.kind === "income" ? "in" : txn.kind === "expense" ? "out" : "none"}
            className="block text-[15px]"
          />
          {others ? (
            <span className="text-muted-foreground block text-[11px] tabular-nums">
              your share {formatPaise(txn.amountPaise - others)}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

function ScheduleRow({ item, data, onEdit }: { item: Recurring; data: FinanceData; onEdit: (r: Recurring) => void }) {
  const pay = usePayRecurring();
  const skip = useSkipRecurring();
  const setActive = useSetRecurringActive();
  const today = todayKey();
  const cat = data.categories.find((c) => c.id === item.categoryId);
  const account = data.accounts.find((a) => a.id === item.accountId);
  const days = daysBetween(today, item.nextOn);
  const due = item.active && days <= 0;
  return (
    <li className={cn("flex items-center gap-3 rounded-xl px-2 py-2.5", !item.active && "opacity-55")}>
      <button type="button" onClick={() => onEdit(item)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <CatIcon category={cat} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium">{item.name}</span>
          <span className="text-muted-foreground block truncate text-[12px]">
            {cadenceLabel(item.cadence, item.every)} · {account?.name ?? "No account"} ·{" "}
            {!item.active ? (
              "paused"
            ) : due ? (
              <span className="text-danger">due {relativeDay(item.nextOn).toLowerCase()}</span>
            ) : (
              `next ${relativeDay(item.nextOn).toLowerCase()}`
            )}
          </span>
        </span>
        <Money paise={item.amountPaise} sign={item.kind === "income" ? "in" : "none"} className="text-[15px]" />
      </button>
      {due && !item.auto ? (
        <Button
          size="sm"
          variant="secondary"
          loading={pay.isPending}
          onClick={() =>
            pay.mutate(item, {
              onSuccess: () => toast.success(item.kind === "expense" ? `${item.name} paid` : `${item.name} received`),
            })
          }
        >
          <CheckCircle />
          {item.kind === "expense" ? "Paid" : "Got it"}
        </Button>
      ) : null}
      <RowMenu
        items={[
          { label: "Edit", icon: PencilSimple, onSelect: () => onEdit(item) },
          ...(item.active
            ? [
                {
                  label: item.kind === "expense" ? "Pay next one now" : "Received next one",
                  icon: CheckCircle,
                  onSelect: () => pay.mutate(item),
                },
                { label: "Skip next one", icon: SkipForward, onSelect: () => skip.mutate(item) },
                { label: "Pause", icon: Pause, onSelect: () => setActive.mutate({ item, active: false }) },
              ]
            : [{ label: "Resume", icon: Play, onSelect: () => setActive.mutate({ item, active: true }) }]),
        ]}
      />
    </li>
  );
}

export function FinancePage() {
  const { data, isLoading } = useFinance();
  const [home, setHome] = usePref("finance.home");
  const [chosenTab, setTab] = useState<Tab | null>(null);
  const tab = chosenTab ?? (home.tab as Tab);
  const [month, setMonth] = useState<MonthKey>(todayKey().slice(0, 7));
  const [txnOpen, setTxnOpen] = useState<{ txn: Transaction | null; draft?: TxnDraft } | null>(null);
  const [accountOpen, setAccountOpen] = useState<{ account: Account | null } | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState<{ item: Recurring | null; kind?: MoneyKind } | null>(null);

  useOpenTarget(["finance"], !!data, ({ id }) => {
    if (id.startsWith("new") && !data?.accounts.some((x) => !x.archived)) return setAccountOpen({ account: null });
    if (id === "new") return setTxnOpen({ txn: null });
    // From the widget: "new-expense", "new-income".
    if (id.startsWith("new-")) return setTxnOpen({ txn: null, draft: { kind: id.slice(4) as TxnDraft["kind"] } });
    const txn = data?.txns.find((t) => t.id === id);
    if (txn) setTxnOpen({ txn });
  });

  const add = (draft?: TxnDraft) => setTxnOpen({ txn: null, draft });
  const noAccounts = !!data && !data.accounts.some((a) => !a.archived);

  return (
    <Page hue={HUE}>
      <PageHeader
        title="Finance"
        description="Where your money is, where it goes and what comes in."
        icon={mod.icon}
        hue={HUE}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCategoriesOpen(true)}>
              <Tag />
              <span className="hidden sm:inline">Categories</span>
            </Button>
            <Button size="sm" onClick={() => (noAccounts ? setAccountOpen({ account: null }) : add())}>
              <Plus />
              {noAccounts ? "Account" : "Add"}
            </Button>
          </>
        }
      />

      <motion.div variants={rise} className="mt-8 flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <Segmented<Tab> label="View" value={tab} onChange={setTab} options={TABS} />
        </div>
        {tab === "transactions" || tab === "analytics" ? <MonthStepper month={month} onChange={setMonth} /> : null}
        {tab !== "analytics" ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            aria-pressed={home.tab === tab}
            onClick={async () => {
              await setHome({ tab, scope: "all" });
              toast.success(`Finance opens on ${TABS.find((t) => t.value === tab)!.label}`);
            }}
            disabled={home.tab === tab}
          >
            <PushPin weight={home.tab === tab ? "fill" : "regular"} />
            <span className="hidden sm:inline">{home.tab === tab ? "Default" : "Make default"}</span>
          </Button>
        ) : null}
      </motion.div>

      <motion.div variants={rise} className="mt-4">
        {isLoading || !data ? (
          <div className="grid gap-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-48" />
          </div>
        ) : noAccounts ? (
          <div className="border-border bg-surface shadow-soft rounded-2xl border">
            <EmptyState
              icon={Wallet}
              hue={HUE}
              title="Start with an account"
              action={
                <Button onClick={() => setAccountOpen({ account: null })}>
                  <Plus />
                  Add an account
                </Button>
              }
            >
              A bank account, cash in your wallet, a UPI wallet or a credit card, with what's in it now. Spending and
              income then keep it up to date.
            </EmptyState>
          </div>
        ) : tab === "overview" ? (
          <Overview
            data={data}
            onAdd={add}
            onOpenTxn={(txn) => setTxnOpen({ txn })}
            onAccount={(account) => setAccountOpen({ account })}
            onSeeAll={() => setTab("transactions")}
            onSchedule={(item) => setRecurringOpen({ item })}
          />
        ) : tab === "transactions" ? (
          <Transactions data={data} month={month} onOpen={(txn) => setTxnOpen({ txn })} />
        ) : tab === "analytics" ? (
          <Analytics data={data} month={month} hue={HUE} />
        ) : (
          <Scheduled
            data={data}
            onEdit={(item) => setRecurringOpen({ item })}
            onNew={(kind) => setRecurringOpen({ item: null, kind })}
          />
        )}
      </motion.div>

      {data ? (
        <>
          <TransactionDialog
            key={txnOpen?.txn?.id ?? "new"}
            open={!!txnOpen}
            onClose={() => setTxnOpen(null)}
            data={data}
            txn={txnOpen?.txn}
            draft={txnOpen?.draft}
            onManageCategories={() => setCategoriesOpen(true)}
          />
          <AccountDialog
            open={!!accountOpen}
            account={accountOpen?.account ?? null}
            balance={accountOpen?.account ? data.balance.get(accountOpen.account.id) : undefined}
            onClose={() => setAccountOpen(null)}
          />
          <CategoriesDialog open={categoriesOpen} data={data} onClose={() => setCategoriesOpen(false)} />
          <RecurringDialog
            open={!!recurringOpen}
            data={data}
            item={recurringOpen?.item ?? null}
            kind={recurringOpen?.kind}
            onClose={() => setRecurringOpen(null)}
            onManageCategories={() => setCategoriesOpen(true)}
          />
        </>
      ) : null}
    </Page>
  );
}

function Overview({
  data,
  onAdd,
  onOpenTxn,
  onAccount,
  onSeeAll,
  onSchedule,
}: {
  data: FinanceData;
  onAdd: (draft?: TxnDraft) => void;
  onOpenTxn: (t: Transaction) => void;
  onAccount: (a: Account | null) => void;
  onSeeAll: () => void;
  onSchedule: (r: Recurring) => void;
}) {
  const today = todayKey();
  const month = today.slice(0, 7);
  const live = data.accounts.filter((a) => !a.archived);
  const total = live.reduce((s, a) => s + (data.balance.get(a.id) ?? 0), 0);
  const debt = totals(debtBalances(data.debts, data.payments));
  const { spends, incomes } = useMemo(() => flows(data.txns, data.debts), [data.txns, data.debts]);
  const spent = sum(inMonth(spends, month));
  const earned = sum(inMonth(incomes, month));
  const upcoming = data.recurring.filter((r) => r.active && daysBetween(today, r.nextOn) <= 10);
  const recent = data.txns.slice(0, 8);

  return (
    <div className="grid gap-6">
      <section className="border-border bg-surface shadow-soft relative overflow-hidden rounded-2xl border p-5 md:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-10 size-56 rounded-full opacity-60 blur-2xl"
          style={{ background: `color-mix(in srgb, ${HUE} 18%, transparent)` }}
        />
        <p className="text-muted-foreground relative text-[13px] font-medium">Total balance</p>
        <p className="relative mt-1 text-[40px] leading-none font-semibold tracking-tight md:text-[48px]">
          {formatPaise(total)}
        </p>
        <div className="relative mt-4 flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
          <span>
            <span className="text-muted-foreground">Spent this month </span>
            <b className="tabular-nums">{formatPaise(spent)}</b>
          </span>
          <span>
            <span className="text-muted-foreground">Came in </span>
            <b className="tabular-nums" style={{ color: earned ? GOOD : undefined }}>
              {formatPaise(earned)}
            </b>
          </span>
          {debt.owedToMe || debt.iOwe ? (
            <Link to={pathOf("debts")} className="hover:underline">
              <span className="text-muted-foreground">Owed to you </span>
              <b className="tabular-nums">{formatPaise(debt.owedToMe)}</b>
              {debt.iOwe ? (
                <>
                  <span className="text-muted-foreground"> · you owe </span>
                  <b className="tabular-nums">{formatPaise(debt.iOwe)}</b>
                </>
              ) : null}
            </Link>
          ) : null}
        </div>
        <div className="relative mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onAdd({ kind: "expense" })}>
            <Plus />
            Expense
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAdd({ kind: "income" })}>
            <Plus />
            Income
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onAdd({ kind: "transfer" })}>
            <ArrowsLeftRight />
            Transfer
          </Button>
        </div>
      </section>

      <section>
        <SectionTitle
          action={
            <Button variant="ghost" size="sm" onClick={() => onAccount(null)}>
              <Plus />
              Account
            </Button>
          }
        >
          Accounts
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {live.map((a) => {
            const balance = data.balance.get(a.id) ?? 0;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onAccount(a)}
                className="border-border bg-surface shadow-soft rounded-2xl border p-4 text-left transition-transform active:scale-[0.98]"
              >
                <div className="flex items-center gap-2.5">
                  <AccountIcon account={a} size={30} />
                  <span className="truncate text-[14px] font-medium">{a.name}</span>
                </div>
                <p
                  className={cn("mt-3 truncate text-[20px] font-semibold tracking-tight", balance < 0 && "text-danger")}
                >
                  {balance < 0 ? "−" : ""}
                  {formatPaise(Math.abs(balance))}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {upcoming.length ? (
        <section>
          <SectionTitle>Coming up</SectionTitle>
          <ul className="border-border bg-surface shadow-soft grid rounded-2xl border p-2">
            {upcoming.map((r) => (
              <ScheduleRow key={r.id} item={r} data={data} onEdit={onSchedule} />
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle
          action={
            data.txns.length > recent.length ? (
              <Button variant="ghost" size="sm" onClick={onSeeAll}>
                See all
              </Button>
            ) : undefined
          }
        >
          Recent
        </SectionTitle>
        <div className="border-border bg-surface shadow-soft rounded-2xl border p-2">
          {recent.length ? (
            <ul className="grid">
              {recent.map((t) => (
                <TxnRow key={t.id} txn={t} data={data} onOpen={onOpenTxn} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-3 py-8 text-center text-[14px]">
              Nothing yet. Add what you spend as you go; it takes a few seconds.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Transactions({
  data,
  month,
  onOpen,
}: {
  data: FinanceData;
  month: MonthKey;
  onOpen: (t: Transaction) => void;
}) {
  const [account, setAccount] = useState("all");
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const others = useMemo(() => othersShares(data.debts), [data.debts]);
  const q = query.trim().toLowerCase();
  const rows = inMonth(data.txns, month).filter(
    (t) =>
      (account === "all" || t.accountId === account || t.toAccountId === account) &&
      (kind === "all" || t.kind === kind) &&
      (!q ||
        [t.note, categoryLabel(data.categories, t.categoryId, "")].some((s) => s?.toLowerCase().includes(q)) ||
        String(t.amountPaise / 100).startsWith(q)),
  );
  const days = [...new Set(rows.map((t) => t.date))];
  const spent = rows
    .filter((t) => t.kind === "expense")
    .reduce((s, t) => s + t.amountPaise - (others.get(t.id) ?? 0), 0);
  const earned = rows.filter((t) => t.kind === "income").reduce((s, t) => s + t.amountPaise, 0);

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1">
          <MagnifyingGlass
            size={15}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes, categories, amounts"
            className="h-9 pl-9 text-[14px]"
          />
        </div>
        <NativeSelect value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
          <option value="all">All accounts</option>
          {data.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind">
          <option value="all">Everything</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </NativeSelect>
      </div>
      <p className="text-muted-foreground px-1 text-[13px]">
        {rows.length} {rows.length === 1 ? "entry" : "entries"} · spent{" "}
        <b className="text-foreground tabular-nums">{formatPaise(spent)}</b> · in{" "}
        <b className="text-foreground tabular-nums">{formatPaise(earned)}</b>
      </p>
      <div className="border-border bg-surface shadow-soft rounded-2xl border p-2">
        {days.length ? (
          days.map((day) => {
            const list = rows.filter((t) => t.date === day);
            const daySpent = list
              .filter((t) => t.kind === "expense")
              .reduce((s, t) => s + t.amountPaise - (others.get(t.id) ?? 0), 0);
            return (
              <section key={day} className="pb-1">
                <h3 className="text-muted-foreground flex justify-between px-2 pt-3 pb-1 text-[12px] font-semibold">
                  <span>{relativeDay(day)}</span>
                  {daySpent ? <span className="tabular-nums">−{formatPaise(daySpent)}</span> : null}
                </h3>
                <ul className="grid">
                  {list.map((t) => (
                    <TxnRow key={t.id} txn={t} data={data} onOpen={onOpen} />
                  ))}
                </ul>
              </section>
            );
          })
        ) : (
          <p className="text-muted-foreground px-3 py-10 text-center text-[14px]">
            {q || account !== "all" || kind !== "all" ? "Nothing matches." : `Nothing in ${monthLabel(month, true)}.`}
          </p>
        )}
      </div>
    </div>
  );
}

function Scheduled({
  data,
  onEdit,
  onNew,
}: {
  data: FinanceData;
  onEdit: (r: Recurring) => void;
  onNew: (kind: MoneyKind) => void;
}) {
  const out = data.recurring.filter((r) => r.kind === "expense");
  const ins = data.recurring.filter((r) => r.kind === "income");
  const monthly = (list: Recurring[]) => list.filter((r) => r.active).reduce((s, r) => s + perMonth(r), 0);
  const section = (title: string, list: Recurring[], kind: MoneyKind, empty: string) => (
    <section>
      <SectionTitle
        action={
          <Button variant="ghost" size="sm" onClick={() => onNew(kind)}>
            <Plus />
            Add
          </Button>
        }
      >
        {title}{" "}
        {list.length ? (
          <span className="text-muted-foreground font-normal">· {formatPaise(monthly(list))} a month</span>
        ) : null}
      </SectionTitle>
      <div className="border-border bg-surface shadow-soft rounded-2xl border p-2">
        {list.length ? (
          <ul className="grid">
            {list.map((r) => (
              <ScheduleRow key={r.id} item={r} data={data} onEdit={onEdit} />
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground flex items-center gap-3 px-3 py-6 text-[14px]">
            <Repeat size={20} className="shrink-0" />
            {empty}
          </div>
        )}
      </div>
    </section>
  );
  return (
    <div className="grid gap-6">
      {section(
        "Subscriptions and bills",
        out,
        "expense",
        "Spotify, Netflix, rent, phone… They're added on their day, so balances stay right.",
      )}
      {section(
        "Allowances and regular income",
        ins,
        "income",
        "Pocket money, stipend, salary… added on the day they arrive.",
      )}
    </div>
  );
}
