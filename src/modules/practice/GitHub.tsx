import { useState } from "react";
import { ArrowSquareOut, ChatCircle, CheckCircle, Circle, GitCommit, GithubLogo, PencilSimple, Plus, Star, Trash, Warning } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { RowMenu } from "@/components/ui/kit";
import type { GhAccount, GhIssue, GhRepo } from "@/core/db/schema";
import { openUrl } from "@/lib/native";
import { useNow } from "@/lib/time";
import { cn, timeAgo } from "@/lib/utils";
import { useRemoveGithub, useSaveGithub } from "./data";

/** GitHub's own language colours, for the dot beside a repository's language. */
const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572a5",
  Rust: "#dea584",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Java: "#b07219",
  Kotlin: "#a97bff",
  Go: "#00add8",
  Swift: "#f05138",
  Dart: "#00b4ab",
  Ruby: "#701516",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  "Jupyter Notebook": "#da5b0b",
};

const githubProfile = (handle: string) => `https://github.com/${handle}`;

export function GithubDialog({ account, onClose }: { account: GhAccount | null; onClose: () => void }) {
  const save = useSaveGithub();
  const [handle, setHandle] = useState(account?.handle ?? "");

  async function submit() {
    if (!handle.trim()) return;
    const report = await save.mutateAsync(handle);
    if (report?.error) toast.error(report.error);
    else toast.success("GitHub connected", { description: report ? `${report.contributions.toLocaleString()} contributions in the last year` : undefined });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>GitHub</DialogTitle>
          <DialogDescription>Public profile data only; no password or token needed.</DialogDescription>
        </DialogHeader>
        <Field
          label="Username"
          htmlFor="gh-handle"
          hint="As in github.com/<username>. Contributions go on the activity heatmap; private ones count only if your profile shows them."
        >
          <Input
            id="gh-handle"
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
            Switching to another account removes {account.handle}'s contributions from the heatmap.
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

export function GithubCard({ account, onEdit, className }: { account: GhAccount | null; onEdit: () => void; className?: string }) {
  const remove = useRemoveGithub();
  if (!account) {
    return (
      <button
        type="button"
        onClick={onEdit}
        className={cn("flex h-full min-h-32 flex-col justify-between rounded-2xl border border-dashed border-border p-4 text-left transition-colors hover:bg-surface-muted", className)}
      >
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <GithubLogo size={16} weight="fill" />
          GitHub
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Plus size={14} />
          Connect
        </span>
      </button>
    );
  }
  const meta = account.meta;
  return (
    <article className={cn("relative flex h-full min-h-32 flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
          <GithubLogo size={16} weight="fill" className="shrink-0" />
          <span className="truncate">GitHub</span>
        </span>
        <span className="-mr-2 -mt-1">
          <RowMenu
            items={[
              { label: "Open profile", icon: ArrowSquareOut, onSelect: () => void openUrl(githubProfile(account.handle)) },
              { label: "Change username", icon: PencilSimple, onSelect: onEdit },
              { label: "Disconnect", icon: Trash, danger: true, onSelect: () => remove.mutate() },
            ]}
          />
        </span>
      </div>
      <p className="truncate text-[13px] text-muted-foreground">{account.handle}</p>
      <div className="mt-auto pt-3">
        {account.syncedAt ? (
          <p className="flex items-baseline gap-2">
            <span className="text-[24px] font-semibold leading-none tracking-tight tabular-nums">{account.contributions.toLocaleString()}</span>
            <span className="truncate text-[12px] font-medium text-muted-foreground">contributions</span>
          </p>
        ) : (
          <p className="text-[13px] text-muted-foreground">Fetching…</p>
        )}
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {account.syncedAt ? `Last year · ${meta.publicRepos ?? 0} repos · ${meta.followers ?? 0} followers` : ""}
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

export function RecentRepos({ repos, handle }: { repos: GhRepo[]; handle: string }) {
  const now = useNow(60_000).getTime();
  if (!repos.length) return <p className="py-6 text-center text-[14px] text-muted-foreground">No recent pushes found.</p>;
  return (
    <ul className="grid gap-1">
      {repos.map((r) => {
        const [owner, name] = r.id.split("/");
        const own = owner.toLowerCase() === handle.toLowerCase();
        return (
          <li key={r.id}>
            <button type="button" onClick={() => void openUrl(r.url)} className="grid w-full gap-0.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[14px] font-medium">
                  {own ? null : <span className="font-normal text-muted-foreground">{owner}/</span>}
                  {name}
                </span>
                {r.fork ? <span className="shrink-0 text-[11px] text-muted-foreground">fork</span> : null}
                <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{timeAgo(r.pushedAt, now)}</span>
              </span>
              {r.commitMessage ? (
                <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                  <GitCommit size={14} className="shrink-0" />
                  <span className="truncate">{r.commitMessage}</span>
                </span>
              ) : r.description ? (
                <span className="truncate text-[13px] text-muted-foreground">{r.description}</span>
              ) : null}
              {r.language || r.stars ? (
                <span className="flex items-center gap-3 text-[12px] text-muted-foreground">
                  {r.language ? (
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: LANGUAGE_COLORS[r.language] ?? "var(--muted-foreground)" }} />
                      {r.language}
                    </span>
                  ) : null}
                  {r.stars ? (
                    <span className="flex items-center gap-1">
                      <Star size={12} />
                      {r.stars}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const ROLE_LABEL: Record<GhIssue["role"], string> = { author: "Opened", assignee: "Assigned", involved: "Involved" };

export function IssueList({ issues, limit = 8 }: { issues: GhIssue[]; limit?: number }) {
  const now = useNow(60_000).getTime();
  const [state, setState] = useState<"open" | "closed">("open");
  const [more, setMore] = useState(false);
  const shown = issues.filter((i) => i.state === state);
  const open = issues.filter((i) => i.state === "open").length;
  return (
    <div className="grid gap-3">
      <Segmented
        label="Issue state"
        value={state}
        onChange={(v) => {
          setState(v);
          setMore(false);
        }}
        options={[
          { value: "open", label: `Open ${open}` },
          { value: "closed", label: `Closed ${issues.length - open}` },
        ]}
        className="justify-self-start"
      />
      {shown.length ? (
        <ul className="-mx-1 grid gap-1">
          {shown.slice(0, more ? undefined : limit).map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => void openUrl(i.url)} className="flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted">
                {i.state === "open" ? (
                  <Circle size={16} weight="bold" className="mt-0.5 shrink-0 text-success" aria-label="Open" />
                ) : (
                  <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0 text-muted-foreground" aria-label="Closed" />
                )}
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-[14px] font-medium">{i.title}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                    <span className="truncate">
                      {i.repo}#{i.number}
                    </span>
                    <span className="rounded-full bg-surface-muted px-1.5 py-px text-[11px] font-medium">{ROLE_LABEL[i.role]}</span>
                    {i.labels.slice(0, 2).map((l) => (
                      <span key={l} className="rounded-full border border-border px-1.5 py-px text-[11px]">
                        {l}
                      </span>
                    ))}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5 text-[12px] text-muted-foreground">
                  <span>{timeAgo(i.closedAt ?? i.updatedAt, now)}</span>
                  {i.comments ? (
                    <span className="flex items-center gap-1">
                      <ChatCircle size={12} />
                      {i.comments}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-6 text-center text-[14px] text-muted-foreground">{state === "open" ? "No open issues." : "No closed issues."}</p>
      )}
      {!more && shown.length > limit ? (
        <button type="button" onClick={() => setMore(true)} className="justify-self-center text-[13px] font-medium text-muted-foreground hover:text-foreground">
          Show all {shown.length}
        </button>
      ) : null}
    </div>
  );
}
