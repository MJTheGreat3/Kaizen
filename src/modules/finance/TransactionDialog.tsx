import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, ArrowsLeftRight, MinusCircle, Plus, Trash, UsersThree } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DateTimeInput } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import type { Transaction } from "@/core/db/schema";
import { todayKey } from "@/lib/dates";
import { formatPaise, parseRupees } from "@/lib/money";
import { cn } from "@/lib/utils";
import { splitEvenly } from "@/modules/debts/balances";
import { pathOf } from "@/modules/registry";
import { sharesByTxn, useDeleteTransaction, useSaveTransaction, type FinanceData } from "./data";
import { categoryLabel } from "./format";
import { AccountSelect, CategoryPicker } from "./parts";

type Kind = Transaction["kind"];
const OTHER = "__other";

interface Person {
  name: string;
  amount: string;
}

export interface TxnDraft {
  kind?: Kind;
  accountId?: string;
}

/** Adds or edits an expense, income or transfer; an expense can be split or paid by someone else. */
export function TransactionDialog({
  open,
  onClose,
  data,
  txn,
  draft,
  onManageCategories,
}: {
  open: boolean;
  onClose: () => void;
  data: FinanceData;
  txn?: Transaction | null;
  draft?: TxnDraft;
  onManageCategories: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open ? (
        <TxnForm
          data={data}
          txn={txn ?? null}
          draft={draft}
          onClose={onClose}
          onManageCategories={onManageCategories}
        />
      ) : null}
    </Dialog>
  );
}

function TxnForm({
  data,
  txn,
  draft,
  onClose,
  onManageCategories,
}: {
  data: FinanceData;
  txn: Transaction | null;
  draft?: TxnDraft;
  onClose: () => void;
  onManageCategories: () => void;
}) {
  const navigate = useNavigate();
  const save = useSaveTransaction();
  const remove = useDeleteTransaction();
  const [defaultAccount] = usePref("finance.defaultAccount");
  const live = data.accounts.filter((a) => !a.archived);
  const fallbackAccount =
    draft?.accountId ?? (live.some((a) => a.id === defaultAccount) ? defaultAccount : (live[0]?.id ?? ""));
  const linked = txn ? (sharesByTxn(data.debts).get(txn.id) ?? []) : [];
  const nameOf = (personId: string) => data.people.find((p) => p.id === personId)?.name ?? "";
  const paidByDebt = linked.find((d) => d.direction === "i_owe");

  const [step, setStep] = useState<"details" | "split">("details");
  const [kind, setKind] = useState<Kind>(txn?.kind ?? draft?.kind ?? "expense");
  const [amount, setAmount] = useState(txn ? String(txn.amountPaise / 100) : "");
  const [categoryId, setCategoryId] = useState<string | null>(txn?.categoryId ?? null);
  const [accountId, setAccountId] = useState(
    txn ? (paidByDebt ? OTHER : (txn.accountId ?? fallbackAccount)) : fallbackAccount,
  );
  const [toAccountId, setToAccountId] = useState(
    txn?.toAccountId ?? live.find((a) => a.id !== fallbackAccount)?.id ?? "",
  );
  const [paidBy, setPaidBy] = useState(paidByDebt ? nameOf(paidByDebt.personId) : "");
  const [date, setDate] = useState(txn?.date ?? todayKey());
  const [note, setNote] = useState(txn?.note ?? "");
  const [people, setPeople] = useState<Person[]>(
    linked
      .filter((d) => d.direction === "owed_to_me")
      .map((d) => ({ name: nameOf(d.personId), amount: String(d.amountPaise / 100) })),
  );
  const [even, setEven] = useState(!linked.some((d) => d.direction === "owed_to_me"));
  const [includeMe, setIncludeMe] = useState(true);
  const [guessed, setGuessed] = useState(false);

  const total = parseRupees(amount) ?? 0;
  const named = people.filter((p) => p.name.trim());
  const evenShares = total && named.length ? splitEvenly(total, named.length + (includeMe ? 1 : 0)) : [];
  const shareOf = (i: number) => (even ? (evenShares[i] ?? 0) : (parseRupees(named[i]?.amount ?? "") ?? 0));
  const othersTotal = named.reduce((s, _, i) => s + shareOf(i), 0);
  const mine = total - othersTotal;
  const someoneElse = kind === "expense" && accountId === OTHER;
  const splitting = kind === "expense" && !someoneElse && named.length > 0;

  const problem = !total
    ? "Enter an amount"
    : kind === "transfer" && (!accountId || !toAccountId || accountId === toAccountId)
      ? "Pick two different accounts"
      : kind !== "transfer" && !someoneElse && !accountId
        ? "Add an account first"
        : someoneElse && !paidBy.trim()
          ? "Who paid?"
          : splitting && mine < 0
            ? "The shares come to more than the total"
            : null;

  // Suggests a category from the last transaction with the same note.
  function onNote(text: string) {
    setNote(text);
    if (kind === "transfer" || (categoryId && !guessed)) return;
    const key = text.trim().toLowerCase();
    const match = key
      ? data.txns.find((x) => x.kind === kind && x.categoryId && x.note?.trim().toLowerCase() === key)
      : undefined;
    if (match) {
      setCategoryId(match.categoryId);
      setGuessed(true);
    }
  }

  async function submit() {
    if (problem) return;
    const reason = note.trim() || categoryLabel(data.categories, categoryId, kind === "income" ? "Income" : "Expense");
    await save.mutateAsync({
      v: {
        id: txn?.id,
        kind,
        amountPaise: total,
        accountId: someoneElse ? null : accountId || null,
        toAccountId: kind === "transfer" ? toAccountId : null,
        categoryId: kind === "transfer" ? null : categoryId,
        date,
        note: note.trim() || null,
        split: splitting ? named.map((p, i) => ({ person: p.name.trim(), amountPaise: shareOf(i) })) : [],
        paidBy: someoneElse ? paidBy.trim() : null,
      },
      reason,
    });
    onClose();
    if (splitting) {
      const names = named.map((p) => p.name.trim());
      toast.success(
        `${names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`} ${names.length === 1 ? "owes" : "owe"} you ${formatPaise(othersTotal)}`,
        {
          description: `Your share, ${formatPaise(mine)}, is what counts as spent.`,
          action: { label: "Debts", onClick: () => void navigate({ to: pathOf("debts") }) },
        },
      );
    } else if (someoneElse) {
      toast.success(`You owe ${paidBy.trim()} ${formatPaise(total)}`, {
        action: { label: "Debts", onClick: () => void navigate({ to: pathOf("debts") }) },
      });
    } else
      toast.success(
        txn ? "Saved" : kind === "income" ? "Income added" : kind === "transfer" ? "Transfer added" : "Expense added",
      );
  }

  const knownPeople = useMemo(() => data.people.map((p) => p.name).sort(), [data.people]);

  if (step === "split") {
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split {formatPaise(total)}</DialogTitle>
          <DialogDescription>
            You paid. The others' shares are added to Debts as owed to you; only your share counts as spent.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Segmented
            label="How"
            value={even ? "even" : "custom"}
            onChange={(v) => setEven(v === "even")}
            options={[
              { value: "even", label: "Equally" },
              { value: "custom", label: "Set amounts" },
            ]}
          />
          {even ? (
            <label className="flex items-center gap-3 text-[14px]">
              <input
                type="checkbox"
                checked={includeMe}
                onChange={(e) => setIncludeMe(e.target.checked)}
                className="size-[18px] accent-[var(--accent)]"
              />
              Include my own share
            </label>
          ) : null}
          <datalist id="fin-people">
            {knownPeople.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <ul className="grid gap-2">
            {people.map((p, i) => {
              const index = named.indexOf(p);
              return (
                <li key={i} className="flex items-center gap-2">
                  <Input
                    aria-label="Name"
                    list="fin-people"
                    value={p.name}
                    placeholder="Name"
                    autoFocus={!p.name}
                    onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  {even ? (
                    <span className="text-muted-foreground w-28 shrink-0 text-right text-[14px] tabular-nums">
                      {index >= 0 ? formatPaise(shareOf(index)) : "–"}
                    </span>
                  ) : (
                    <Input
                      aria-label="Amount"
                      inputMode="decimal"
                      className="w-28 shrink-0"
                      value={p.amount}
                      placeholder="₹"
                      onChange={(e) =>
                        setPeople(people.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
                      }
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remove"
                    onClick={() => setPeople(people.filter((_, j) => j !== i))}
                  >
                    <MinusCircle />
                  </Button>
                </li>
              );
            })}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-start"
            onClick={() => setPeople([...people, { name: "", amount: "" }])}
          >
            <Plus />
            Add person
          </Button>
          <div className="bg-surface-muted grid grid-cols-2 gap-2 rounded-xl px-4 py-3 text-[14px]">
            <span className="text-muted-foreground">Others owe you</span>
            <span className="text-right font-semibold tabular-nums">{formatPaise(othersTotal)}</span>
            <span className="text-muted-foreground">Your share</span>
            <span className={cn("text-right font-semibold tabular-nums", mine < 0 && "text-danger")}>
              {formatPaise(mine)}
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => setStep("details")}>
            <ArrowLeft />
            Back
          </Button>
          <Button onClick={() => setStep("details")} disabled={mine < 0}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="md:max-w-xl">
      <DialogHeader>
        <DialogTitle>{txn ? "Edit transaction" : "Add money in or out"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <Segmented
          label="Type"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setCategoryId(null);
            if (k !== "expense" && accountId === OTHER) setAccountId(fallbackAccount);
          }}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
            { value: "transfer", label: "Transfer" },
          ]}
        />
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label={splitting ? "Total paid (₹)" : "Amount (₹)"} htmlFor="txn-amount">
            <Input
              id="txn-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus={!txn}
              className="h-12 text-[22px] font-semibold tabular-nums"
              placeholder="0"
            />
          </Field>
          <Field label="Date" htmlFor="txn-date">
            <DateTimeInput
              id="txn-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-12"
            />
          </Field>
        </div>

        {kind === "transfer" ? (
          <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
            <Field label="From" htmlFor="txn-from">
              <AccountSelect id="txn-from" accounts={data.accounts} value={accountId} onChange={setAccountId} />
            </Field>
            <ArrowsLeftRight size={18} className="text-muted-foreground mb-3" />
            <Field label="To" htmlFor="txn-to">
              <AccountSelect id="txn-to" accounts={data.accounts} value={toAccountId} onChange={setToAccountId} />
            </Field>
          </div>
        ) : (
          <>
            <CategoryPicker
              kind={kind}
              categories={data.categories}
              value={categoryId}
              onChange={(id) => (setCategoryId(id), setGuessed(false))}
              onManage={onManageCategories}
            />
            <div className={cn("grid gap-3", someoneElse && "grid-cols-2")}>
              <Field label={kind === "income" ? "Into" : "Paid from"} htmlFor="txn-account">
                <AccountSelect
                  id="txn-account"
                  accounts={data.accounts}
                  value={accountId}
                  onChange={setAccountId}
                  extra={kind === "expense" ? [{ value: OTHER, label: "Someone else paid" }] : undefined}
                />
              </Field>
              {someoneElse ? (
                <Field label="Who paid" htmlFor="txn-paid-by" hint="You'll owe them this in Debts.">
                  <Input
                    id="txn-paid-by"
                    list="fin-people"
                    value={paidBy}
                    onChange={(e) => setPaidBy(e.target.value)}
                  />
                </Field>
              ) : null}
            </div>
          </>
        )}

        <Field label="Note" htmlFor="txn-note">
          <Input
            id="txn-note"
            value={note}
            onChange={(e) => onNote(e.target.value)}
            placeholder={
              kind === "income" ? "Pocket money, refund…" : kind === "transfer" ? "Card bill, ATM…" : "Lunch, cab…"
            }
          />
        </Field>
        <datalist id="fin-people">
          {knownPeople.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        {kind === "expense" && !someoneElse ? (
          <button
            type="button"
            onClick={() => {
              if (!people.length) setPeople([{ name: "", amount: "" }]);
              setStep("split");
            }}
            disabled={!total}
            className="border-border hover:bg-surface-muted/60 flex items-center gap-3 rounded-xl border border-dashed px-4 py-3 text-left text-[14px] transition-colors disabled:opacity-50"
          >
            <UsersThree size={20} className="text-muted-foreground shrink-0" />
            <span className="flex-1">
              {splitting ? (
                <>
                  Split with {named.map((p) => p.name.trim()).join(", ")} · your share{" "}
                  <b className="tabular-nums">{formatPaise(Math.max(0, mine))}</b>
                </>
              ) : (
                "Split with others"
              )}
            </span>
            <span className="text-muted-foreground text-[13px]">{splitting ? "Change" : ""}</span>
          </button>
        ) : null}
      </div>
      <DialogFooter className="items-center">
        {txn ? (
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={async () => {
              await remove.mutateAsync(txn.id);
              toast.success("Deleted");
              onClose();
            }}
          >
            <Trash />
            Delete
          </Button>
        ) : null}
        {problem && total ? <span className="text-danger text-[13px]">{problem}</span> : null}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!!problem} loading={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
