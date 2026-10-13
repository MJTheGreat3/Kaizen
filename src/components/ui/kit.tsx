import * as React from "react";
import { DropdownMenu as Menu } from "radix-ui";
import { motion } from "motion/react";
import { ArrowUp, Check, DotsThree } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";
import { spring } from "@/lib/motion";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./dialog";

// ---------------------------------------------------------------------------
// Round checkbox with a drawn tick
// ---------------------------------------------------------------------------

export function CheckCircle({
  checked,
  onChange,
  hue = "var(--accent)",
  label,
  size = 22,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  hue?: string;
  label: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className="relative grid shrink-0 place-items-center rounded-full transition-transform active:scale-90"
      style={{ width: size, height: size }}
    >
      <motion.span
        className="absolute inset-0 rounded-full"
        initial={false}
        animate={{
          backgroundColor: checked ? hue : "rgba(0,0,0,0)",
          boxShadow: checked ? `inset 0 0 0 1.5px ${hue}` : "inset 0 0 0 1.5px var(--input)",
          scale: checked ? [1, 1.15, 1] : 1,
        }}
        transition={{ duration: 0.3 }}
      />
      <svg viewBox="0 0 24 24" className="relative" style={{ width: size * 0.62, height: size * 0.62 }} aria-hidden>
        <motion.path
          d="M5 12.5l4.5 4.5L19 7.5"
          fill="none"
          stroke="white"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export function Chip({
  children,
  hue,
  icon: IconCmp,
  className,
  tone = "muted",
}: {
  children: React.ReactNode;
  hue?: string;
  icon?: Icon;
  className?: string;
  tone?: "muted" | "hue" | "danger";
}) {
  const style =
    tone === "hue" && hue
      ? { background: `color-mix(in srgb, ${hue} 14%, transparent)`, color: `color-mix(in srgb, ${hue} 75%, var(--foreground))` }
      : undefined;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[12px] font-medium",
        tone === "muted" && "bg-surface-muted text-muted-foreground",
        tone === "danger" && "bg-danger-soft text-danger",
        className,
      )}
      style={style}
    >
      {IconCmp ? <IconCmp size={13} weight="bold" /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

const fieldBase =
  "w-full min-w-0 rounded-lg border border-input bg-surface px-3.5 text-[15px] text-foreground shadow-soft transition-[border-color,box-shadow] placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "min-h-24 resize-y py-2.5 leading-relaxed", className)} {...props} />;
}

export function DateTimeInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "h-11 [color-scheme:light] dark:[color-scheme:dark]", className)} {...props} />;
}

/** Row of toggle pills for picking several values. */
export function PillToggle<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-95",
              on ? "border-transparent bg-accent text-accent-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Colour swatches. */
export function ColorPicker({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className="grid size-8 place-items-center rounded-full transition-transform active:scale-90"
          style={{ background: c, boxShadow: value === c ? `0 0 0 2px var(--surface), 0 0 0 4px ${c}` : undefined }}
        >
          {value === c ? <Check size={14} weight="bold" className="text-white" /> : null}
        </button>
      ))}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Quick add: one input that understands natural language
// ---------------------------------------------------------------------------

export function QuickAdd({
  placeholder,
  onSubmit,
  preview,
  hue,
  autoFocus,
}: {
  placeholder: string;
  onSubmit: (text: string) => Promise<boolean | void> | boolean | void;
  /** Live interpretation of the current text, shown under the input. */
  preview?: (text: string) => React.ReactNode;
  hue: string;
  autoFocus?: boolean;
}) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const shown = text.trim() ? preview?.(text) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const ok = await onSubmit(text.trim());
      if (ok !== false) setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-border bg-surface shadow-soft transition-shadow focus-within:shadow-float">
      <div className="flex items-center gap-2 py-1.5 pl-4 pr-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          enterKeyHint="done"
          className="h-10 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground/80"
        />
        <motion.button
          type="submit"
          aria-label="Add"
          disabled={!text.trim() || busy}
          animate={{ scale: text.trim() ? 1 : 0.85, opacity: text.trim() ? 1 : 0.4 }}
          transition={spring}
          className="grid size-9 place-items-center rounded-xl text-white shadow-soft"
          style={{ background: hue }}
        >
          <ArrowUp size={18} weight="bold" />
        </motion.button>
      </div>
      {shown ? <div className="flex flex-wrap gap-1.5 border-t border-border/70 px-4 py-2.5">{shown}</div> : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  icon?: Icon;
  onSelect: () => void;
  danger?: boolean;
}

export function RowMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <button
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground data-[state=open]:bg-surface-muted"
        >
          <DotsThree size={20} weight="bold" />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-44 rounded-xl border border-border bg-surface p-1 shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {items.map((item) => (
            <Menu.Item
              key={item.label}
              onSelect={item.onSelect}
              className={cn(
                "flex h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[14px] outline-none data-[highlighted]:bg-surface-muted",
                item.danger && "text-danger",
              )}
            >
              {item.icon ? <item.icon size={16} /> : null}
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}

// ---------------------------------------------------------------------------
// Empty state and confirm dialog
// ---------------------------------------------------------------------------

export function EmptyState({
  icon: IconCmp,
  hue,
  title,
  children,
  action,
}: {
  icon: Icon;
  hue: string;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span
        className="grid size-14 place-items-center rounded-2xl"
        style={{ background: `color-mix(in srgb, ${hue} 14%, transparent)`, color: hue }}
      >
        <IconCmp size={28} weight="duotone" />
      </span>
      <p className="mt-4 text-[16px] font-semibold tracking-tight">{title}</p>
      {children ? <p className="mt-1 max-w-[42ch] text-[14px] leading-relaxed text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  danger = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  danger?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Section title used inside module pages. */
export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}
