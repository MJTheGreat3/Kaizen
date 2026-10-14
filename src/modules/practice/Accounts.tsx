import { useState } from "react";
import { ArrowSquareOut, PencilSimple, Plus, Trash, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { RowMenu } from "@/components/ui/kit";
import type { CpAccount } from "@/core/db/schema";
import { openUrl } from "@/lib/native";
import { timeAgo } from "@/lib/utils";
import { useRemoveAccount, useSaveAccount } from "./data";
import { ratingColor, type PlatformInfo } from "./logic";

const HINTS: Record<string, string> = {
  codeforces: "As in codeforces.com/profile/<handle>.",
  leetcode: "As in leetcode.com/u/<username>. Only your last 20 solves are public, so history builds up from now on; totals are complete.",
  atcoder: "As in atcoder.jp/users/<name>.",
  codechef: "As in codechef.com/users/<handle>.",
};

export function AccountDialog({ platform, account, onClose }: { platform: PlatformInfo; account: CpAccount | null; onClose: () => void }) {
  const save = useSaveAccount();
  const [handle, setHandle] = useState(account?.handle ?? "");

  async function submit() {
    if (!handle.trim()) return;
    const [report] = await save.mutateAsync({ platform: platform.id, handle });
    if (report?.error) toast.error(report.error);
    else toast.success(`${platform.name} connected`, { description: report?.newSolves ? `${report.newSolves} solved problems imported` : undefined });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{platform.name}</DialogTitle>
          <DialogDescription>Public profile data only; no password needed.</DialogDescription>
        </DialogHeader>
        <Field label={platform.handleLabel} htmlFor="cp-handle" hint={HINTS[platform.id]}>
          <Input
            id="cp-handle"
            value={handle}
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
        </Field>
        {account && account.handle.toLowerCase() !== handle.trim().toLowerCase() && handle.trim() ? (
          <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
            <Warning size={16} className="mt-0.5 shrink-0" />
            Switching to another account removes the problems imported for {account.handle}.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!handle.trim()} loading={save.isPending}>
            {account ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AccountCard({ platform, account, onEdit }: { platform: PlatformInfo; account: CpAccount | undefined; onEdit: () => void }) {
  const remove = useRemoveAccount();
  if (!account) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className="flex h-full min-h-32 flex-col justify-between rounded-2xl border border-dashed border-border p-4 text-left transition-colors hover:bg-surface-muted"
      >
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <span className="size-2.5 rounded-full" style={{ background: platform.color }} />
          {platform.name}
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Plus size={14} />
          Connect
        </span>
      </button>
    );
  }
  const color = ratingColor(platform.id, account.rating);
  const meta = account.meta as { easy?: number; medium?: number; hard?: number };
  return (
    <article className="relative flex h-full min-h-32 flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: platform.color }} />
          <span className="truncate">{platform.name}</span>
        </span>
        <span className="-mr-2 -mt-1">
          <RowMenu
            items={[
              { label: "Open profile", icon: ArrowSquareOut, onSelect: () => void openUrl(platform.profile(account.handle)) },
              { label: "Change handle", icon: PencilSimple, onSelect: onEdit },
              { label: "Disconnect", icon: Trash, danger: true, onSelect: () => remove.mutate(platform.id) },
            ]}
          />
        </span>
      </div>
      <p className="truncate text-[13px] text-muted-foreground">{account.handle}</p>
      <div className="mt-auto pt-3">
        {account.rating !== null ? (
          <p className="flex items-baseline gap-2">
            <span className="text-[24px] font-semibold leading-none tracking-tight tabular-nums">{Math.round(account.rating)}</span>
            {account.rankTitle ? (
              <span className="flex items-center gap-1 truncate text-[12px] font-medium text-muted-foreground">
                <span className="size-2 rounded-full" style={{ background: color }} />
                {account.rankTitle}
              </span>
            ) : null}
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">{account.syncedAt ? "Unrated" : "Fetching…"}</p>
        )}
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {account.maxRating ? `Max ${Math.round(account.maxRating)} · ` : ""}
          {account.solved} solved
          {meta.easy !== undefined ? ` (${meta.easy}/${meta.medium}/${meta.hard})` : ""}
        </p>
        {account.error ? (
          <p className="mt-1 flex items-center gap-1 text-[12px] text-danger" title={account.error}>
            <Warning size={12} className="shrink-0" />
            <span className="truncate">{account.error}</span>
          </p>
        ) : account.syncedAt ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground/80">Updated {timeAgo(account.syncedAt)}</p>
        ) : null}
      </div>
    </article>
  );
}
