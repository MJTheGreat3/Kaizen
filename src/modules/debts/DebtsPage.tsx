import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarBlank,
  CheckCircle as CheckIcon,
  HandCoins,
  PaperPlaneTilt,
  Plus,
  Receipt,
  Trash,
  UsersThree,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Segmented, Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Chip, DateTimeInput, EmptyState, QuickAdd, RowMenu, SectionTitle } from "@/components/ui/kit";
import type { Account, Person } from "@/core/db/schema";
import { parseDebt } from "@/core/nl/parse";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { useOpenTarget } from "@/core/shell/openRequest";
import { daysBetween, relativeDay, todayKey } from "@/lib/dates";
import { ease, rise } from "@/lib/motion";
import { formatPaise, parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { AccountSelect } from "@/modules/finance/parts";
import { saveTransaction, useAccounts, useMoneyMutation } from "@/modules/finance/data";
import { modules } from "@/modules/registry";
import { nudgeMessage, splitEvenly, totals } from "./balances";
import { useAddDebt, useAddMany, useAddPayment, useDebts, useDeleteEntry, type DebtsData } from "./data";

const mod = modules.find((m) => m.id === "debts")!;
const HUE = mod.hue;
const GOOD = "#3fa66b";
const BAD = "#e05a5a";

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function avatarHue(name: string) {
  const palette = ["#5b6ee1", "#3d8bd9", "#2fa5a0", "#3fa66b", "#d4b62c", "#e8673a", "#d9608f", "#8e6bd8"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const hue = avatarHue(name);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `color-mix(in srgb, ${hue} 18%, transparent)`,
        color: `color-mix(in srgb, ${hue} 80%, var(--foreground))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

function BalanceText({ paise, className }: { paise: number; className?: string }) {
  if (paise === 0) return <span className={cn("text-muted-foreground", className)}>Settled</span>;
  return (
    <span className={cn("font-semibold tabular-nums", className)} style={{ color: paise > 0 ? GOOD : BAD }}>
      {formatPaise(Math.abs(paise))}
    </span>
  );
}

function Stat({ label, value, color, delay }: { label: string; value: number; color?: string; delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease, delay }}
      className="rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5"
    >
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold tabular-nums tracking-tight md:text-[26px]" style={{ color }}>
        {formatPaise(value)}
      </p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

function EntryDialog({
  open,
  onClose,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  defaults?: { person?: string; kind?: "debt" | "payment"; direction?: "owed_to_me" | "i_owe" };
}) {
  const addDebt = useAddDebt();
  const addPayment = useAddPayment();
  const [kind, setKind] = useState<"debt" | "payment">(defaults?.kind ?? "debt");
  const [direction, setDirection] = useState<"in" | "out">(defaults?.direction === "i_owe" ? "out" : "in");
  const [person, setPerson] = useState(defaults?.person ?? "");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayKey());
  const [due, setDue] = useState("");
  const { accounts, fallback } = useAccounts();
  const [accountPick, setAccountPick] = useState<string | null>(null);
  // Lending and repayments move money; owing someone for what they paid doesn't, unless chosen.
  const account = accountPick ?? (kind === "payment" || direction === "in" ? fallback : "");
  const paise = parseRupees(amount);

  async function save() {
    if (!person.trim() || !paise) return;
    if (kind === "debt") {
      await addDebt.mutateAsync({
        person,
        direction: direction === "in" ? "owed_to_me" : "i_owe",
        amountPaise: paise,
        occurredOn: date,
        reason: reason.trim() || null,
        dueOn: due || null,
        accountId: account || null,
      });
    } else {
      await addPayment.mutateAsync({
        person,
        direction: direction === "in" ? "to_me" : "from_me",
        amountPaise: paise,
        paidOn: date,
        note: reason.trim() || null,
        accountId: account || null,
      });
    }
    toast.success(kind === "debt" ? "Recorded" : "Payment recorded");
    onClose();
  }

  const inLabel = kind === "debt" ? "They owe me" : "They paid me";
  const outLabel = kind === "debt" ? "I owe them" : "I paid them";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind === "debt" ? "New entry" : "Record a payment"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Segmented
            label="Type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "debt", label: "Money lent or owed" },
              { value: "payment", label: "Repayment" },
            ]}
          />
          <Segmented
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "in", label: inLabel, icon: <ArrowDownLeft /> },
              { value: "out", label: outLabel, icon: <ArrowUpRight /> },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Person" htmlFor="debt-person">
              <Input id="debt-person" value={person} onChange={(e) => setPerson(e.target.value)} autoComplete="off" />
            </Field>
            <Field label="Amount (₹)" htmlFor="debt-amount" error={amount && !paise ? "Enter an amount" : null}>
              <Input id="debt-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          </div>
          <Field label={kind === "debt" ? "What for" : "Note"} htmlFor="debt-reason">
            <Input id="debt-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pizza, cab, tickets..." />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="debt-date">
              <DateTimeInput id="debt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            {kind === "debt" ? (
              <Field label="Due (optional)" htmlFor="debt-due">
                <DateTimeInput id="debt-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </Field>
            ) : null}
          </div>
          {accounts.length ? (
            <Field
              label={direction === "in" ? (kind === "debt" ? "Paid from" : "Into") : kind === "debt" ? "Into" : "Paid from"}
              htmlFor="debt-account"
              hint={account ? "Moves this account's balance in Finance." : "Doesn't change any balance."}
            >
              <AccountSelect id="debt-account" accounts={accounts} value={account} onChange={setAccountPick} extra={[{ value: "", label: "No account" }]} />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!person.trim() || !paise} loading={addDebt.isPending || addPayment.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitDialog({ open, onClose, people }: { open: boolean; onClose: () => void; people: Person[] }) {
  const addMany = useAddMany();
  const addExpense = useMoneyMutation((v: Parameters<typeof saveTransaction>[0]) => saveTransaction(v, v.note ?? "Split bill"));
  const { accounts, fallback } = useAccounts();
  const [accountPick, setAccountPick] = useState<string | null>(null);
  const account = accountPick ?? fallback;
  const [total, setTotal] = useState("");
  const [reason, setReason] = useState("");
  const [names, setNames] = useState("");
  const [includeMe, setIncludeMe] = useState(true);
  const list = names
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  const totalPaise = parseRupees(total);
  const shares = totalPaise && list.length ? splitEvenly(totalPaise, list.length + (includeMe ? 1 : 0)) : [];
  const each = shares.length ? shares[shares.length - 1] : 0;

  async function save() {
    if (!totalPaise || !list.length) return;
    if (account) {
      // Paid from an account: the whole bill leaves it, my share counts as spent, the rest is owed to me.
      await addExpense.mutateAsync({
        kind: "expense",
        amountPaise: totalPaise,
        accountId: account,
        toAccountId: null,
        categoryId: null,
        date: todayKey(),
        note: reason.trim() || "Split bill",
        split: list.map((person, i) => ({ person, amountPaise: shares[i] })),
        paidBy: null,
      });
      toast.success(`Split between ${list.length + (includeMe ? 1 : 0)} people`, { description: "Added to Finance too; pick a category there." });
      onClose();
      return;
    }
    await addMany.mutateAsync(
      list.map((person, i) => ({
        person,
        direction: "owed_to_me" as const,
        amountPaise: shares[i],
        occurredOn: todayKey(),
        reason: reason.trim() || "Split bill",
      })),
    );
    toast.success(`Split between ${list.length + (includeMe ? 1 : 0)} people`);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split a bill</DialogTitle>
          <DialogDescription>You paid; everyone else owes you their share.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total (₹)" htmlFor="split-total">
              <Input id="split-total" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
            </Field>
            <Field label="What for" htmlFor="split-reason">
              <Input id="split-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Dinner" />
            </Field>
          </div>
          <Field label="People" htmlFor="split-people" hint={people.length ? `Known: ${people.slice(0, 6).map((p) => p.name).join(", ")}` : "Separate names with commas."}>
            <Input id="split-people" value={names} onChange={(e) => setNames(e.target.value)} placeholder="Rahul, Priya, Aman" />
          </Field>
          <label className="flex items-center gap-3 text-[14px]">
            <input type="checkbox" checked={includeMe} onChange={(e) => setIncludeMe(e.target.checked)} className="size-[18px] accent-[var(--accent)]" />
            Include my own share
          </label>
          {accounts.length ? (
            <Field label="Paid from" htmlFor="split-account" hint={account ? "Also added to Finance as an expense at your share." : "Only recorded here."}>
              <AccountSelect id="split-account" accounts={accounts} value={account} onChange={setAccountPick} extra={[{ value: "", label: "Not tracked in Finance" }]} />
            </Field>
          ) : null}
          {each ? (
            <p className="rounded-xl bg-surface-muted px-4 py-3 text-[14px]">
              Each person owes about <span className="font-semibold">{formatPaise(each)}</span>
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!totalPaise || !list.length} loading={addMany.isPending || addExpense.isPending}>
            Add {list.length || ""} entries
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Records a repayment, by default the whole balance, into or out of an account. */
function SettleDialog({ person, balance, accounts, onClose }: { person: Person; balance: number; accounts: Account[]; onClose: () => void }) {
  const addPayment = useAddPayment();
  const { fallback } = useAccounts();
  const [amount, setAmount] = useState(String(Math.abs(balance) / 100));
  const [accountPick, setAccountPick] = useState<string | null>(null);
  const [date, setDate] = useState(todayKey());
  const account = accountPick ?? fallback;
  const paise = parseRupees(amount);
  const toMe = balance > 0;

  async function save() {
    if (!paise) return;
    await addPayment.mutateAsync({ person: person.name, direction: toMe ? "to_me" : "from_me", amountPaise: paise, paidOn: date, note: paise >= Math.abs(balance) ? "Settled up" : "Part payment", accountId: account || null });
    const name = accounts.find((a) => a.id === account)?.name;
    toast.success(paise >= Math.abs(balance) ? `Settled with ${person.name}` : `${formatPaise(paise)} recorded`, {
      description: name ? `${toMe ? "Added to" : "Taken from"} ${name}.` : undefined,
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{toMe ? `${person.name} paid you` : `You paid ${person.name}`}</DialogTitle>
          <DialogDescription>
            {toMe ? "Owes you " : "You owe "}
            {formatPaise(Math.abs(balance))}. A smaller amount leaves the rest open.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" htmlFor="settle-amount" error={amount && !paise ? "Enter an amount" : null}>
            <Input id="settle-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Date" htmlFor="settle-date">
            <DateTimeInput id="settle-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {accounts.length ? (
            <Field label={toMe ? "Into" : "Paid from"} htmlFor="settle-account" className="col-span-2">
              <AccountSelect id="settle-account" accounts={accounts} value={account} onChange={setAccountPick} extra={[{ value: "", label: "No account" }]} />
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!paise} loading={addPayment.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Person detail
// ---------------------------------------------------------------------------

function PersonDialog({ person, data, onClose }: { person: Person | null; data: DebtsData; onClose: () => void }) {
  const remove = useDeleteEntry();
  const { accounts } = useAccounts();
  const [entryOpen, setEntryOpen] = useState(false);
  const [settling, setSettling] = useState(false);
  if (!person) return null;
  const balance = data.balance.get(person.id) ?? 0;
  const history = [
    ...data.debts
      .filter((d) => d.personId === person.id)
      .map((d) => ({ kind: "debt" as const, id: d.id, date: d.occurredOn, amount: d.amountPaise, in: d.direction === "owed_to_me", text: d.reason, due: d.dueOn, created: d.createdAt, accountId: d.accountId, split: !!d.txnId })),
    ...data.payments
      .filter((p) => p.personId === person.id)
      .map((p) => ({ kind: "payment" as const, id: p.id, date: p.paidOn, amount: p.amountPaise, in: p.direction === "to_me", text: p.note, due: null, created: p.createdAt, accountId: p.accountId, split: false })),
  ].sort((a, b) => (a.date === b.date ? b.created - a.created : a.date < b.date ? 1 : -1));

  async function nudge() {
    if (!person) return;
    const reasons = history.filter((h) => h.kind === "debt" && h.in && h.text).map((h) => h.text!);
    const text = nudgeMessage(person.name, formatPaise(balance), reasons);
    try {
      if (navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      // Share sheet dismissed or unavailable: fall back to the clipboard.
    }
    await navigator.clipboard.writeText(text);
    toast.success("Reminder copied", { description: "Paste it into WhatsApp or a message." });
  }

  return (
    <Dialog open={!!person} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-xl">
        <div className="flex items-center gap-4 pr-8">
          <Avatar name={person.name} size={52} />
          <div>
            <DialogTitle>{person.name}</DialogTitle>
            <p className="mt-0.5 text-[14px] text-muted-foreground">
              {balance > 0 ? "Owes you " : balance < 0 ? "You owe " : ""}
              <BalanceText paise={balance} />
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEntryOpen(true)}>
            <Plus />
            Add entry
          </Button>
          {balance !== 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setSettling(true)}>
              <CheckIcon />
              Settle up
            </Button>
          ) : null}
          {balance > 0 ? (
            <Button size="sm" variant="secondary" onClick={nudge}>
              <PaperPlaneTilt />
              Nudge
            </Button>
          ) : null}
        </div>

        <ul className="grid gap-1">
          {history.map((h) => (
            <li key={`${h.kind}-${h.id}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full"
                style={{
                  background: `color-mix(in srgb, ${h.kind === "payment" ? "#7487a3" : h.in ? GOOD : BAD} 14%, transparent)`,
                  color: h.kind === "payment" ? "#7487a3" : h.in ? GOOD : BAD,
                }}
              >
                {h.kind === "payment" ? <Receipt size={18} /> : h.in ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium first-letter:uppercase">
                  {h.kind === "payment" ? (h.in ? "Paid you back" : "You paid back") : h.text || (h.in ? "Lent" : "Borrowed")}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {relativeDay(h.date)}
                  {h.due ? `, due ${relativeDay(h.due).toLowerCase()}` : ""}
                  {h.split ? " · split in Finance" : ""}
                  {h.accountId ? ` · ${accounts.find((a) => a.id === h.accountId)?.name ?? "account"}` : ""}
                </p>
              </div>
              <span className="text-[14px] font-semibold tabular-nums">{formatPaise(h.amount)}</span>
              <RowMenu items={[{ label: "Delete", icon: Trash, danger: true, onSelect: () => remove.mutate({ kind: h.kind, id: h.id }) }]} />
            </li>
          ))}
        </ul>
        <EntryDialog open={entryOpen} onClose={() => setEntryOpen(false)} defaults={{ person: person.name }} />
        {settling ? <SettleDialog person={person} balance={balance} accounts={accounts} onClose={() => setSettling(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function ParsedPreview({ text }: { text: string }) {
  const p = parseDebt(text);
  if (!p) return <span className="text-[13px] text-muted-foreground">Try "Rahul owes 250 for pizza" or "I owe Priya 1200 for cab"</span>;
  const incoming = p.direction === "owed_to_me" || p.direction === "to_me";
  const label =
    p.type === "debt" ? (incoming ? `${p.person} owes you` : `You owe ${p.person}`) : incoming ? `${p.person} paid you` : `You paid ${p.person}`;
  return (
    <>
      <Chip tone="hue" hue={incoming ? GOOD : BAD} icon={incoming ? ArrowDownLeft : ArrowUpRight}>
        {label}
      </Chip>
      <Chip>{formatPaise(p.amountPaise)}</Chip>
      {p.reason ? <Chip>{p.reason}</Chip> : null}
      <Chip icon={CalendarBlank}>{relativeDay(p.occurredOn)}</Chip>
    </>
  );
}

export function DebtsPage() {
  const { data, isLoading } = useDebts();
  const addDebt = useAddDebt();
  const addPayment = useAddPayment();
  const { fallback } = useAccounts();
  const [entryOpen, setEntryOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [selected, setSelected] = useState<Person | null>(null);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const today = todayKey();

  useOpenTarget(["people", "debts"], !!data, ({ module, id }) => {
    if (id === "new") return setEntryOpen(true);
    const personId = module === "debts" ? data?.debts.find((d) => d.id === id)?.personId : id;
    setSelected(data?.people.find((p) => p.id === personId) ?? null);
  });

  const sum = data ? totals(data.balance) : { owedToMe: 0, iOwe: 0, net: 0 };
  const people = useMemo(() => {
    if (!data) return [];
    return data.people
      .map((p) => ({ person: p, balance: data.balance.get(p.id) ?? 0 }))
      .filter((x) => filter === "all" || x.balance !== 0)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [data, filter]);

  const dueSoon = useMemo(() => {
    if (!data) return [];
    return data.debts
      .filter((d) => d.dueOn && daysBetween(today, d.dueOn) <= 7 && (data.balance.get(d.personId) ?? 0) !== 0)
      .sort((a, b) => (a.dueOn! < b.dueOn! ? -1 : 1));
  }, [data, today]);

  return (
    <Page hue={HUE}>
      <PageHeader
        title="Debts"
        description="Who owes you, and whom you owe."
        icon={mod.icon}
        hue={HUE}
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSplitOpen(true)}>
              <UsersThree />
              Split
            </Button>
            <Button size="sm" onClick={() => setEntryOpen(true)}>
              <Plus />
              New
            </Button>
          </>
        }
      />

      <motion.div variants={rise} className="mt-8 grid grid-cols-3 gap-3">
        <Stat label="Owed to you" value={sum.owedToMe} color={sum.owedToMe ? GOOD : undefined} delay={0.05} />
        <Stat label="You owe" value={sum.iOwe} color={sum.iOwe ? BAD : undefined} delay={0.1} />
        <Stat label="Net" value={sum.net} delay={0.15} />
      </motion.div>

      <motion.div variants={rise} className="mt-4">
        <QuickAdd
          hue={HUE}
          placeholder='e.g. "Rahul owes 250 for pizza yesterday"'
          preview={(text) => <ParsedPreview text={text} />}
          onSubmit={async (text) => {
            const p = parseDebt(text);
            if (!p) {
              toast.error("Couldn't read that", { description: 'Try "Rahul owes 250 for pizza" or use New.' });
              return false;
            }
            if (p.type === "debt") {
              await addDebt.mutateAsync({ person: p.person, direction: p.direction, amountPaise: p.amountPaise, occurredOn: p.occurredOn, reason: p.reason });
            } else {
              await addPayment.mutateAsync({ person: p.person, direction: p.direction, amountPaise: p.amountPaise, paidOn: p.occurredOn, note: p.reason, accountId: fallback });
            }
            toast.success("Recorded");
          }}
        />
      </motion.div>

      {dueSoon.length ? (
        <motion.section variants={rise} className="mt-8">
          <SectionTitle>Due soon</SectionTitle>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {dueSoon.map((d) => {
              const person = data!.people.find((p) => p.id === d.personId)!;
              const overdue = d.dueOn! < today;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelected(person)}
                  className="min-w-52 shrink-0 rounded-2xl border border-border bg-surface p-4 text-left shadow-soft transition-transform active:scale-[0.98]"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar name={person.name} size={30} />
                    <span className="text-[14px] font-medium">{person.name}</span>
                  </div>
                  <p className="mt-3 text-[18px] font-semibold tabular-nums" style={{ color: d.direction === "owed_to_me" ? GOOD : BAD }}>
                    {formatPaise(d.amountPaise)}
                  </p>
                  <p className={cn("mt-0.5 text-[12px]", overdue ? "text-danger" : "text-muted-foreground")}>
                    {overdue ? "Overdue, " : "Due "}
                    {relativeDay(d.dueOn!).toLowerCase()}
                  </p>
                </button>
              );
            })}
          </div>
        </motion.section>
      ) : null}

      <motion.section variants={rise} className="mt-8">
        <SectionTitle
          action={
            <Segmented
              label="Filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "open", label: "Open" },
                { value: "all", label: "Everyone" },
              ]}
            />
          }
        >
          People
        </SectionTitle>
        <div className="rounded-2xl border border-border bg-surface p-2 shadow-soft">
          {isLoading ? (
            <div className="grid gap-2 p-2">
              <Skeleton className="h-14" />
              <Skeleton className="h-14" />
            </div>
          ) : !people.length ? (
            <EmptyState icon={HandCoins} hue={HUE} title={filter === "open" ? "All square" : "No one yet"}>
              {filter === "open"
                ? "Nobody owes you and you owe nobody. Record something above when it happens."
                : 'Type "Rahul owes 250 for pizza" above to start.'}
            </EmptyState>
          ) : (
            <ul className="grid">
              <AnimatePresence initial={false}>
                {people.map(({ person, balance }) => (
                  <motion.li
                    key={person.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease }}
                  >
                    <button
                      onClick={() => setSelected(person)}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-muted/70"
                    >
                      <Avatar name={person.name} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{person.name}</span>
                        <span className="text-[13px] text-muted-foreground">
                          {balance > 0 ? "owes you" : balance < 0 ? "you owe" : "settled"}
                        </span>
                      </span>
                      <BalanceText paise={balance} className="text-[16px]" />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </motion.section>

      <EntryDialog key={String(entryOpen)} open={entryOpen} onClose={() => setEntryOpen(false)} />
      <SplitDialog key={`s${splitOpen}`} open={splitOpen} onClose={() => setSplitOpen(false)} people={data?.people ?? []} />
      {data ? <PersonDialog person={selected} data={data} onClose={() => setSelected(null)} /> : null}
    </Page>
  );
}
