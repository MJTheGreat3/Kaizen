import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CaretRight, Plus, Trash } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Segmented, Switch } from "@/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ColorPicker, ConfirmDialog, DateTimeInput } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import type { Account, AccountKind, Cadence, Category, MoneyKind, Recurring } from "@/core/db/schema";
import { todayKey } from "@/lib/dates";
import { formatPaise, parseRupees } from "@/lib/money";
import { PALETTE } from "@/lib/palette";
import { cn } from "@/lib/utils";
import {
  useDeleteAccount,
  useDeleteCategory,
  useDeleteRecurring,
  useSaveAccount,
  useSaveCategory,
  useSaveRecurring,
  type FinanceData,
} from "./data";
import { ACCOUNT_KINDS, CATEGORY_ICONS } from "./icons";
import { cadenceLabel } from "./logic";
import { AccountSelect, CatIcon, CategoryPicker } from "./parts";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** Parses a signed amount ("-2,500" for a card that starts owing). */
const signedPaise = (text: string) => {
  const t = text.trim();
  if (!t || t === "0") return 0;
  const neg = t.startsWith("-") || t.startsWith("−");
  const p = parseRupees(neg ? t.slice(1) : t);
  return p === null ? null : neg ? -p : p;
};

export function AccountDialog({
  open,
  account,
  balance,
  onClose,
}: {
  open: boolean;
  account: Account | null;
  balance?: number;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open ? <AccountForm account={account} balance={balance} onClose={onClose} /> : null}
    </Dialog>
  );
}

function AccountForm({
  account,
  balance,
  onClose,
}: {
  account: Account | null;
  balance?: number;
  onClose: () => void;
}) {
  const save = useSaveAccount();
  const remove = useDeleteAccount();
  const [defaultAccount, setDefaultAccount] = usePref("finance.defaultAccount");
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "bank");
  const [color, setColor] = useState(account?.color ?? PALETTE[1]);
  // A new account starts from what's in it now; an existing one can be corrected to today's balance.
  const [amount, setAmount] = useState(account ? String((balance ?? account.openingPaise) / 100) : "");
  const [makeDefault, setMakeDefault] = useState(account ? defaultAccount === account.id : !defaultAccount);
  const [deleting, setDeleting] = useState(false);
  const paise = signedPaise(amount);

  async function submit() {
    if (!name.trim() || paise === null) return;
    // Correcting the balance shifts the opening amount by the difference.
    const openingPaise = account ? account.openingPaise + (paise - (balance ?? account.openingPaise)) : paise;
    const id = await save.mutateAsync({ id: account?.id, name: name.trim(), kind, color, openingPaise });
    if (makeDefault) await setDefaultAccount(id);
    else if (account && defaultAccount === account.id) await setDefaultAccount("");
    onClose();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{account ? "Edit account" : "New account"}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {ACCOUNT_KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              aria-pressed={kind === k.value}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium",
                kind === k.value
                  ? "border-foreground/30 bg-surface-muted text-foreground"
                  : "text-muted-foreground hover:bg-surface-muted/60 border-transparent",
              )}
            >
              <k.icon size={20} weight={kind === k.value ? "duotone" : "regular"} />
              {k.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" htmlFor="acc-name">
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "credit" ? "HDFC card" : kind === "cash" ? "Wallet" : "SBI savings"}
              autoFocus={!account}
            />
          </Field>
          <Field
            label={account ? "Balance now (₹)" : "Balance (₹)"}
            htmlFor="acc-balance"
            hint={kind === "credit" ? "Negative if the card owes money." : undefined}
            error={paise === null ? "Enter an amount" : null}
          >
            <Input
              id="acc-balance"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </Field>
        </div>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">Colour</span>
          <ColorPicker colors={PALETTE} value={color} onChange={setColor} />
        </div>
        <label className="flex items-center justify-between gap-3 text-[14px]">
          Pick this first for new entries
          <Switch checked={makeDefault} onCheckedChange={setMakeDefault} />
        </label>
      </div>
      <DialogFooter>
        {account ? (
          <Button variant="danger-ghost" className="mr-auto" onClick={() => setDeleting(true)}>
            <Trash />
            Delete
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!name.trim() || paise === null} loading={save.isPending}>
          Save
        </Button>
      </DialogFooter>
      {account ? (
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={`Delete ${account.name}?`}
          description="Its transactions stay in your history and analytics, but it no longer counts towards your balance."
          confirmLabel="Delete"
          onConfirm={async () => {
            await remove.mutateAsync(account.id);
            toast.success("Account deleted");
            onClose();
          }}
        />
      ) : null}
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function CategoriesDialog({ open, data, onClose }: { open: boolean; data: FinanceData; onClose: () => void }) {
  const [kind, setKind] = useState<MoneyKind>("expense");
  const [editing, setEditing] = useState<{ category: Category | null; parentId: string | null } | null>(null);
  const live = data.categories.filter((c) => c.kind === kind);
  const tops = live.filter((c) => !c.parentId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-lg">
        {editing ? (
          <CategoryForm
            key={editing.category?.id ?? `new-${editing.parentId}`}
            kind={kind}
            data={data}
            category={editing.category}
            parentId={editing.parentId}
            onDone={() => setEditing(null)}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Categories</DialogTitle>
              <DialogDescription>
                What money goes on and comes from. Subcategories roll up into their category.
              </DialogDescription>
            </DialogHeader>
            <Segmented
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: "expense", label: "Spending" },
                { value: "income", label: "Income" },
              ]}
            />
            <ul className="-mx-2 grid max-h-[55vh] gap-0.5 overflow-y-auto">
              {tops.map((top) => (
                <li key={top.id}>
                  <button
                    type="button"
                    onClick={() => setEditing({ category: top, parentId: null })}
                    className="hover:bg-surface-muted/70 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left"
                  >
                    <CatIcon category={top} size={34} />
                    <span className="flex-1 text-[15px] font-medium">{top.name}</span>
                    <CaretRight size={14} className="text-muted-foreground" />
                  </button>
                  <ul className="ml-12 grid">
                    {live
                      .filter((c) => c.parentId === top.id)
                      .map((sub) => (
                        <li key={sub.id}>
                          <button
                            type="button"
                            onClick={() => setEditing({ category: sub, parentId: top.id })}
                            className="hover:bg-surface-muted/70 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[14px]"
                          >
                            <CatIcon category={sub} size={24} />
                            <span className="flex-1">{sub.name}</span>
                          </button>
                        </li>
                      ))}
                    <li>
                      <button
                        type="button"
                        onClick={() => setEditing({ category: null, parentId: top.id })}
                        className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 px-2 py-1.5 text-[13px]"
                      >
                        <Plus size={13} />
                        Subcategory
                      </button>
                    </li>
                  </ul>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setEditing({ category: null, parentId: null })}>
                <Plus />
                New category
              </Button>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CategoryForm({
  kind,
  data,
  category,
  parentId,
  onDone,
}: {
  kind: MoneyKind;
  data: FinanceData;
  category: Category | null;
  parentId: string | null;
  onDone: () => void;
}) {
  const save = useSaveCategory();
  const remove = useDeleteCategory();
  const parent = parentId ? data.categories.find((c) => c.id === parentId) : undefined;
  const [name, setName] = useState(category?.name ?? "");
  const [icon, setIcon] = useState(category?.icon ?? parent?.icon ?? "dots-three");
  const [color, setColor] = useState(category?.color ?? parent?.color ?? PALETTE[0]);
  const [parentPick, setParentPick] = useState<string>(category?.parentId ?? parentId ?? "");
  const hasChildren = !!category && data.categories.some((c) => c.parentId === category.id);
  const tops = data.categories.filter((c) => c.kind === kind && !c.parentId && c.id !== category?.id);

  async function submit() {
    if (!name.trim()) return;
    await save.mutateAsync({ id: category?.id, name: name.trim(), kind, icon, color, parentId: parentPick || null });
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={onDone}>
            <ArrowLeft />
          </Button>
          {category ? "Edit category" : parentId ? `New in ${parent?.name}` : "New category"}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="flex items-end gap-3">
          <CatIcon category={{ icon, color }} size={44} />
          <Field label="Name" htmlFor="cat-name" className="flex-1">
            <Input id="cat-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
        </div>
        {!hasChildren ? (
          <Field label="Inside" htmlFor="cat-parent">
            <select
              id="cat-parent"
              value={parentPick}
              onChange={(e) => setParentPick(e.target.value)}
              className="border-input bg-surface h-10 rounded-lg border px-3 text-[14px]"
            >
              <option value="">Nothing (a main category)</option>
              {tops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">Icon</span>
          <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto sm:grid-cols-10">
            {Object.entries(CATEGORY_ICONS).map(([key, Icon]) => (
              <button
                key={key}
                type="button"
                aria-label={key}
                aria-pressed={icon === key}
                onClick={() => setIcon(key)}
                className={cn(
                  "grid aspect-square place-items-center rounded-lg",
                  icon === key ? "bg-surface-muted text-foreground" : "text-muted-foreground hover:bg-surface-muted/60",
                )}
                style={icon === key ? { boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
              >
                <Icon size={20} weight={icon === key ? "duotone" : "regular"} />
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">Colour</span>
          <ColorPicker colors={PALETTE} value={color} onChange={setColor} />
        </div>
      </div>
      <DialogFooter>
        {category ? (
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={async () => {
              await remove.mutateAsync(category.id);
              toast.success(hasChildren ? "Category and its subcategories removed" : "Category removed", {
                description: "Past entries show as uncategorised.",
              });
              onDone();
            }}
          >
            <Trash />
            Delete
          </Button>
        ) : null}
        <Button onClick={submit} disabled={!name.trim()} loading={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Scheduled payments
// ---------------------------------------------------------------------------

export function RecurringDialog({
  open,
  data,
  item,
  kind: initialKind,
  onClose,
  onManageCategories,
}: {
  open: boolean;
  data: FinanceData;
  item: Recurring | null;
  kind?: MoneyKind;
  onClose: () => void;
  onManageCategories: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open ? (
        <RecurringForm
          data={data}
          item={item}
          initialKind={initialKind}
          onClose={onClose}
          onManageCategories={onManageCategories}
        />
      ) : null}
    </Dialog>
  );
}

function RecurringForm({
  data,
  item,
  initialKind,
  onClose,
  onManageCategories,
}: {
  data: FinanceData;
  item: Recurring | null;
  initialKind?: MoneyKind;
  onClose: () => void;
  onManageCategories: () => void;
}) {
  const save = useSaveRecurring();
  const remove = useDeleteRecurring();
  const [defaultAccount] = usePref("finance.defaultAccount");
  const live = data.accounts.filter((a) => !a.archived);
  const [kind, setKind] = useState<MoneyKind>(item?.kind ?? initialKind ?? "expense");
  const [name, setName] = useState(item?.name ?? "");
  const [amount, setAmount] = useState(item ? String(item.amountPaise / 100) : "");
  const [accountId, setAccountId] = useState(
    item?.accountId ?? (live.some((a) => a.id === defaultAccount) ? defaultAccount : (live[0]?.id ?? "")),
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    item?.categoryId ?? (kind === "expense" ? "cat:subscriptions" : "cat:allowance"),
  );
  const [cadence, setCadence] = useState<Cadence>(item?.cadence ?? "monthly");
  const [every, setEvery] = useState(String(item?.every ?? 1));
  const [anchor, setAnchor] = useState(item?.anchorDate ?? todayKey());
  const [auto, setAuto] = useState(item?.auto ?? true);
  const paise = parseRupees(amount);
  const n = Math.max(1, Math.round(Number(every)) || 1);
  const valid = !!name.trim() && !!paise && !!accountId;

  async function submit() {
    if (!valid) return;
    await save.mutateAsync({
      id: item?.id,
      kind,
      name: name.trim(),
      amountPaise: paise!,
      accountId,
      categoryId,
      cadence,
      every: n,
      anchorDate: anchor,
      auto,
      note: null,
    });
    toast.success(item ? "Saved" : kind === "expense" ? "Subscription added" : "Allowance added");
    onClose();
  }

  return (
    <DialogContent className="md:max-w-xl">
      <DialogHeader>
        <DialogTitle>
          {item ? "Edit schedule" : kind === "expense" ? "New subscription or bill" : "New allowance or regular income"}
        </DialogTitle>
      </DialogHeader>
      <div className="grid gap-4">
        {!item ? (
          <Segmented
            label="Kind"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setCategoryId(k === "expense" ? "cat:subscriptions" : "cat:allowance");
            }}
            options={[
              { value: "expense", label: "Money out" },
              { value: "income", label: "Money in" },
            ]}
          />
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" htmlFor="rec-name">
            <Input
              id="rec-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "expense" ? "Spotify" : "Pocket money"}
              autoFocus={!item}
            />
          </Field>
          <Field label="Amount (₹)" htmlFor="rec-amount">
            <Input id="rec-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
        </div>
        <CategoryPicker
          kind={kind}
          categories={data.categories}
          value={categoryId}
          onChange={setCategoryId}
          onManage={onManageCategories}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "expense" ? "Paid from" : "Into"} htmlFor="rec-account">
            <AccountSelect id="rec-account" accounts={data.accounts} value={accountId} onChange={setAccountId} />
          </Field>
          <Field label={item ? "Starting" : "First due"} htmlFor="rec-anchor">
            <DateTimeInput id="rec-anchor" type="date" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-[auto_1fr] items-end gap-3">
          <Field label="Every" htmlFor="rec-every">
            <Input
              id="rec-every"
              inputMode="numeric"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              className="w-16"
            />
          </Field>
          <Segmented
            label="Cadence"
            value={cadence}
            onChange={setCadence}
            options={[
              { value: "weekly", label: n === 1 ? "Week" : "Weeks" },
              { value: "monthly", label: n === 1 ? "Month" : "Months" },
              { value: "yearly", label: n === 1 ? "Year" : "Years" },
            ]}
          />
        </div>
        <label className="flex items-center justify-between gap-3 text-[14px]">
          <span>
            Add it automatically on the day
            <span className="text-muted-foreground block text-[12px]">
              Off: it waits on the Scheduled tab until you mark it {kind === "expense" ? "paid" : "received"}.
            </span>
          </span>
          <Switch checked={auto} onCheckedChange={setAuto} />
        </label>
        {paise ? (
          <p className="bg-surface-muted rounded-xl px-4 py-3 text-[14px]">
            {formatPaise(paise)} {cadenceLabel(cadence, n).toLowerCase()}
          </p>
        ) : null}
      </div>
      <DialogFooter>
        {item ? (
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={async () => {
              await remove.mutateAsync(item.id);
              toast.success("Schedule removed", { description: "Payments already added stay." });
              onClose();
            }}
          >
            <Trash />
            Delete
          </Button>
        ) : null}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={!valid} loading={save.isPending}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
