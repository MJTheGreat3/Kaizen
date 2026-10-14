import { useMemo, useState } from "react";
import { ArrowClockwise, ArrowSquareOut, Bell, CheckCircle as CheckIcon, Clock, Trash, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DateTimeInput, Textarea } from "@/components/ui/kit";
import type { CpContest, CpProblem, CpRevisit } from "@/core/db/schema";
import { relativeDay, todayKey, toKey } from "@/lib/dates";
import { openUrl } from "@/lib/native";
import { useNow } from "@/lib/time";
import { cn, timeUntil } from "@/lib/utils";
import { useAddRevisit, useDeleteProblem, useLogProblem, useRemoveRevisit, useReviewRevisit, useSetLoggedSolved, useUpdateProblem } from "./data";
import { difficultyColor, platformOf, REVISIT_DAYS, tagLabel } from "./logic";

const sourceName = (p: CpProblem) => platformOf(p.platform)?.name ?? p.code;
const sourceColor = (platform: string) => platformOf(platform)?.color ?? "var(--muted-foreground)";

export function ProblemRow({ problem, onOpen }: { problem: CpProblem; onOpen: () => void }) {
  const when = problem.solvedAt ?? problem.lastAt;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-muted">
      <span className="size-2 shrink-0 rounded-full" style={{ background: sourceColor(problem.platform) }} title={sourceName(problem)} />
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[14px] font-medium">{problem.name}</span>
        <span className="truncate text-[12px] text-muted-foreground">
          {sourceName(problem)}
          {problem.tags.length ? ` · ${problem.tags.slice(0, 3).join(", ")}` : ""}
        </span>
      </span>
      {problem.difficulty ? (
        <span className="shrink-0 text-[12px] font-semibold tabular-nums" style={{ color: difficultyColor(problem) }}>
          {problem.difficulty}
        </span>
      ) : null}
      <span className="hidden w-20 shrink-0 text-right text-[12px] text-muted-foreground sm:block">
        {problem.solvedAt ? (when ? relativeDay(toKey(new Date(when))) : "") : "Unsolved"}
      </span>
    </button>
  );
}

export function ProblemDialog({ problem, revisit, onClose }: { problem: CpProblem; revisit: CpRevisit | undefined; onClose: () => void }) {
  const update = useUpdateProblem();
  const addRevisit = useAddRevisit();
  const removeRevisit = useRemoveRevisit();
  const remove = useDeleteProblem();
  const setSolved = useSetLoggedSolved();
  const [notes, setNotes] = useState(problem.notes ?? "");
  const [minutes, setMinutes] = useState(problem.minutes ? String(problem.minutes) : "");
  const [solution, setSolution] = useState(problem.solutionUrl ?? "");
  const logged = problem.platform === "other";
  const queued = revisit && revisit.status === "active" && !revisit.deletedAt;

  async function save() {
    await update.mutateAsync({ id: problem.id, notes: notes.trim() || null, minutes: Number(minutes) > 0 ? Math.round(Number(minutes)) : null, solutionUrl: solution.trim() || null });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && void save()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-2">{problem.name}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: sourceColor(problem.platform) }} />
              {sourceName(problem)}
            </span>
            {problem.difficulty ? (
              <span className="font-semibold" style={{ color: difficultyColor(problem) }}>
                {problem.difficulty}
              </span>
            ) : null}
            <span>
              {problem.solvedAt ? `Solved ${relativeDay(toKey(new Date(problem.solvedAt))).toLowerCase()}` : "Not solved yet"}
              {logged ? "" : ` · ${problem.attempts} ${problem.attempts === 1 ? "submission" : "submissions"}`}
            </span>
          </DialogDescription>
        </DialogHeader>
        {problem.tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {problem.tags.map((t) => (
              <span key={t} className="rounded-full bg-surface-muted px-2.5 py-1 text-[12px]">
                {tagLabel(t)}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {problem.url ? (
            <Button variant="secondary" size="sm" onClick={() => void openUrl(problem.url!)}>
              <ArrowSquareOut />
              Open problem
            </Button>
          ) : null}
          {queued ? (
            <Button variant="secondary" size="sm" onClick={() => removeRevisit.mutate(problem.id)}>
              <X />
              Remove from revisit
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => addRevisit.mutate(problem.id)}>
              <ArrowClockwise />
              Revisit later
            </Button>
          )}
          {logged ? (
            <Button variant="secondary" size="sm" onClick={() => setSolved.mutate({ problem, solved: !problem.solvedAt })}>
              <CheckIcon />
              {problem.solvedAt ? "Mark unsolved" : "Mark solved"}
            </Button>
          ) : null}
        </div>
        {queued ? (
          <p className="text-[13px] text-muted-foreground">
            In the revisit queue, next {relativeDay(revisit.dueDate).toLowerCase()} (step {revisit.stage + 1} of {REVISIT_DAYS.length}).
          </p>
        ) : null}
        <div className="grid gap-3">
          <Field label="Notes" htmlFor="cp-notes" hint="The idea, the trick, what went wrong.">
            <Textarea id="cp-notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="grid grid-cols-[8rem_1fr] gap-3">
            <Field label="Minutes taken" htmlFor="cp-minutes">
              <Input id="cp-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
            <Field label="Solution link" htmlFor="cp-solution">
              <Input id="cp-solution" value={solution} onChange={(e) => setSolution(e.target.value)} placeholder="Gist, submission, repo" />
            </Field>
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          {logged ? (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={async () => {
                await remove.mutateAsync(problem.id);
                onClose();
              }}
            >
              <Trash />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} loading={update.isPending}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SOURCES = ["CSES", "AtCoder", "CodeChef", "Codeforces", "LeetCode", "GeeksforGeeks", "InterviewBit", "Book", "Other"];

export function LogDialog({ onClose }: { onClose: () => void }) {
  const log = useLogProblem();
  const [name, setName] = useState("");
  const [source, setSource] = useState("CSES");
  const [url, setUrl] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [tags, setTags] = useState("");
  const [date, setDate] = useState(todayKey());
  const [solved, setSolved] = useState(true);
  const [minutes, setMinutes] = useState("");
  const [notes, setNotes] = useState("");
  const [revisit, setRevisit] = useState(false);

  async function submit() {
    if (!name.trim()) return;
    await log.mutateAsync({
      name: name.trim(),
      source,
      url: url.trim() || null,
      difficulty: difficulty.trim() || null,
      tags: tags
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
      date,
      solved,
      minutes: Number(minutes) > 0 ? Math.round(Number(minutes)) : null,
      notes: notes.trim() || null,
      revisit,
    });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a problem</DialogTitle>
          <DialogDescription>For problems the connected sites don't report: CSES, books, other judges.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Problem" htmlFor="log-name">
            <Input id="log-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Two Sets II" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Source" htmlFor="log-source">
              <NativeSelect id="log-source" className="h-11 w-full text-[14px]" value={source} onChange={(e) => setSource(e.target.value)}>
                {SOURCES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Difficulty" htmlFor="log-difficulty">
              <Input id="log-difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} placeholder="1600, Medium" />
            </Field>
          </div>
          <Field label="Link (optional)" htmlFor="log-url">
            <Input id="log-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://cses.fi/problemset/task/1093" />
          </Field>
          <Field label="Topics (comma separated)" htmlFor="log-tags">
            <Input id="log-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="dp, combinatorics" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="log-date">
              <DateTimeInput id="log-date" type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} />
            </Field>
            <Field label="Minutes taken" htmlFor="log-minutes">
              <Input id="log-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="log-notes">
            <Textarea id="log-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <label className="flex items-center justify-between gap-3 text-[14px]">
            Solved it
            <Switch checked={solved} onCheckedChange={setSolved} aria-label="Solved it" />
          </label>
          <label className="flex items-center justify-between gap-3 text-[14px]">
            Add to the revisit queue
            <Switch checked={revisit} onCheckedChange={setRevisit} aria-label="Add to the revisit queue" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()} loading={log.isPending}>
            Log problem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RevisitList({ items, problems, onOpen }: { items: CpRevisit[]; problems: CpProblem[]; onOpen: (p: CpProblem) => void }) {
  const review = useReviewRevisit();
  const today = todayKey();
  const active = items.filter((r) => r.status === "active");
  const due = active.filter((r) => r.dueDate <= today);
  const later = active.filter((r) => r.dueDate > today);
  const byId = useMemo(() => new Map(problems.map((p) => [p.id, p])), [problems]);
  if (!active.length) {
    return <p className="py-6 text-center text-[14px] text-muted-foreground">Problems worth redoing come back here after 1, 3, 7 and 21 days. Add one from its details.</p>;
  }
  return (
    <div className="grid gap-1">
      {due.length ? null : <p className="px-1 pb-2 text-[13px] text-muted-foreground">Nothing due today.</p>}
      {due.map((r) => {
        const p = byId.get(r.problemId);
        if (!p) return null;
        return (
          <div key={r.id} className="flex items-center gap-2 rounded-xl px-1 py-1.5">
            <button type="button" onClick={() => onOpen(p)} className="grid min-w-0 flex-1 text-left">
              <span className="truncate text-[14px] font-medium">{p.name}</span>
              <span className="text-[12px] text-muted-foreground">
                {sourceName(p)} · step {r.stage + 1} of {REVISIT_DAYS.length}
                {r.dueDate < today ? ` · due ${relativeDay(r.dueDate).toLowerCase()}` : ""}
              </span>
            </button>
            {p.url ? (
              <Button size="icon-sm" variant="ghost" aria-label="Open problem" onClick={() => void openUrl(p.url!)}>
                <ArrowSquareOut />
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => review.mutate({ item: r, solved: false })}>
              Struggled
            </Button>
            <Button size="sm" onClick={() => review.mutate({ item: r, solved: true })}>
              Solved
            </Button>
          </div>
        );
      })}
      {later.length ? (
        <p className="px-1 pt-2 text-[12px] text-muted-foreground">
          {later.length} more coming up, next {relativeDay(later[0].dueDate).toLowerCase()}.
        </p>
      ) : null}
    </div>
  );
}

export function ContestList({ contests, platforms, limit = 8 }: { contests: CpContest[]; platforms: string[]; limit?: number }) {
  const now = useNow(60_000).getTime();
  const shown = contests.filter((c) => platforms.includes(c.platform) && c.startAt + c.durationMin * 60_000 > now).slice(0, limit);
  if (!shown.length) return <p className="py-6 text-center text-[14px] text-muted-foreground">No upcoming contests found yet.</p>;
  return (
    <ul className="grid gap-1">
      {shown.map((c) => {
        const live = c.startAt <= now;
        return (
          <li key={c.id}>
            <button type="button" onClick={() => void openUrl(c.url)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted">
              <span className="size-2 shrink-0 rounded-full" style={{ background: sourceColor(c.platform) }} title={platformOf(c.platform)?.name} />
              <span className="grid min-w-0 flex-1">
                <span className="truncate text-[14px] font-medium">{c.name}</span>
                <span className="text-[12px] text-muted-foreground">
                  {new Date(c.startAt).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  {" · "}
                  {c.durationMin >= 60 ? `${Math.floor(c.durationMin / 60)} h${c.durationMin % 60 ? ` ${c.durationMin % 60} min` : ""}` : `${c.durationMin} min`}
                </span>
              </span>
              <span className={cn("flex shrink-0 items-center gap-1 text-[12px] font-medium", live ? "text-danger" : "text-muted-foreground")}>
                {live ? <Bell size={12} weight="fill" /> : <Clock size={12} />}
                {live ? "Live" : timeUntil(c.startAt, now)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
