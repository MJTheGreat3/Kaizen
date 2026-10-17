import { createElement } from "react";
import { GearSix } from "@phosphor-icons/react";

import { NativeSelect } from "@/components/ui/controls";
import type { Account, Category, MoneyKind } from "@/core/db/schema";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { accountIcon, iconOf } from "./icons";

export const GOOD = "#3fa66b";
export const BAD = "#e05a5a";

/** A category's icon on a soft tile of its colour. */
export function CatIcon({
  category,
  size = 36,
}: {
  category: Pick<Category, "icon" | "color"> | null | undefined;
  size?: number;
}) {
  const hue = category?.color ?? "#7487a3";
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-xl"
      style={{
        width: size,
        height: size,
        background: `color-mix(in srgb, ${hue} 16%, transparent)`,
        color: `color-mix(in srgb, ${hue} 85%, var(--foreground))`,
      }}
    >
      {createElement(iconOf(category?.icon), { size: size * 0.52, weight: "duotone" })}
    </span>
  );
}

export function AccountIcon({ account, size = 36 }: { account: Pick<Account, "kind" | "color">; size?: number }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-xl text-white"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, color-mix(in srgb, ${account.color} 85%, white), color-mix(in srgb, ${account.color} 80%, black))`,
      }}
    >
      {createElement(accountIcon(account.kind), { size: size * 0.52, weight: "duotone" })}
    </span>
  );
}

/** Signed money in the colour of its direction. */
export function Money({ paise, sign, className }: { paise: number; sign?: "in" | "out" | "none"; className?: string }) {
  const s = sign ?? (paise < 0 ? "out" : "none");
  return (
    <span className={cn("font-semibold tabular-nums", className)} style={{ color: s === "in" ? GOOD : undefined }}>
      {s === "in" ? "+" : s === "out" ? "−" : ""}
      {formatPaise(Math.abs(paise))}
    </span>
  );
}

/**
 * Top-level categories as a grid; picking one shows its subcategories, and
 * either the parent or a subcategory can be chosen.
 */
export function CategoryPicker({
  kind,
  categories,
  value,
  onChange,
  onManage,
}: {
  kind: MoneyKind;
  categories: Category[];
  value: string | null;
  onChange: (id: string) => void;
  onManage?: () => void;
}) {
  const live = categories.filter((c) => c.kind === kind && !c.archived);
  const tops = live.filter((c) => !c.parentId);
  const selected = live.find((c) => c.id === value);
  const openTop = selected?.parentId ?? selected?.id ?? null;
  const subs = openTop ? live.filter((c) => c.parentId === openTop) : [];
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
        {tops.map((cat) => {
          const on = openTop === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onChange(cat.id)}
              aria-pressed={on}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center text-[11px] leading-tight font-medium transition-colors",
                on
                  ? "bg-surface-muted text-foreground border-transparent"
                  : "text-muted-foreground hover:bg-surface-muted/60 border-transparent",
              )}
              style={on ? { boxShadow: `inset 0 0 0 1.5px ${cat.color}` } : undefined}
            >
              <CatIcon category={cat} size={32} />
              <span className="line-clamp-2">{cat.name}</span>
            </button>
          );
        })}
        {onManage ? (
          <button
            type="button"
            onClick={onManage}
            className="text-muted-foreground hover:bg-surface-muted/60 flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium"
          >
            <span className="border-border grid size-8 place-items-center rounded-xl border border-dashed">
              <GearSix size={16} />
            </span>
            Edit
          </button>
        ) : null}
      </div>
      {subs.length ? (
        <div className="flex flex-wrap gap-1.5">
          {[live.find((c) => c.id === openTop)!, ...subs].map((cat, i) => {
            const on = value === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onChange(cat.id)}
                aria-pressed={on}
                className={cn(
                  "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors",
                  on
                    ? "bg-foreground text-background border-transparent"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {i === 0 ? `Any ${cat.name.toLowerCase()}` : cat.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AccountSelect({
  accounts,
  value,
  onChange,
  id,
  extra,
  className,
}: {
  accounts: Account[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  /** Options before the accounts, e.g. "Someone else paid". */
  extra?: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className="[&>span]:flex">
      <NativeSelect
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-10 w-full text-[14px]", className)}
      >
        {extra?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
        {accounts
          .filter((a) => !a.archived || a.id === value)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </NativeSelect>
    </div>
  );
}
