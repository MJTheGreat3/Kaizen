import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { BookOpen, Check, Pause, Play, Plus, Timer, Trash, X } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/kit";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import type { ReadingSession, Task } from "@/core/db/schema";
import { relativeDay, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { hoursMinutes } from "@/modules/review/logic";
import { setTaskDone, useTasks } from "./data";
import { ItemCover } from "./DetailsFinder";
import { clock, elapsedMs, totalsOf, useLogSession, useReadingSessions, useRemoveSession, useRunning, type Running } from "./reading";

/** Re-renders every second while `on`. */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** The running session: the book, a ticking clock, pause and done. */
export function ReadingBar({ books, hue }: { books: Task[]; hue: string }) {
  const { running, pause, resume, stop } = useRunning();
  const now = useNow(!!running && !running.pausedAt);
  const [finishing, setFinishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const book = running ? books.find((b) => b.id === running.taskId) : undefined;
  if (!running || !book) return null;
  const paused = !!running.pausedAt;

  return (
    <motion.div
      variants={rise}
      className="mt-4 flex items-center gap-3 rounded-2xl border p-3 shadow-soft"
      style={{ borderColor: `color-mix(in srgb, ${hue} 35%, var(--border))`, background: `color-mix(in srgb, ${hue} 8%, var(--surface))` }}
    >
      {book.meta.cover ? <ItemCover task={book} className="h-14 w-10" /> : null}
      <div className="min-w-0 flex-1">
        <p className="text-muted-foreground text-[12px] font-medium">{paused ? "Paused" : "Reading"}</p>
        <p className="truncate text-[15px] font-medium">{book.title}</p>
      </div>
      <span className={cn("text-[22px] font-semibold tabular-nums tracking-tight", paused && "text-muted-foreground")}>
        {clock(elapsedMs(running, now))}
      </span>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Discard session" onClick={() => setDiscarding(true)}>
          <X />
        </Button>
        <Button variant="secondary" size="icon-sm" aria-label={paused ? "Resume" : "Pause"} onClick={() => void (paused ? resume() : pause())}>
          {paused ? <Play weight="fill" /> : <Pause weight="fill" />}
        </Button>
        <Button size="icon-sm" aria-label="Finish session" onClick={() => setFinishing(true)}>
          <Check weight="bold" />
        </Button>
      </div>
      <SessionDialog open={finishing} task={book} run={running} onClose={() => setFinishing(false)} />
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this session?"
        description="The time read so far won't be logged."
        confirmLabel="Discard"
        onConfirm={() => stop()}
      />
    </motion.div>
  );
}

/**
 * Logs a session: from the running clock (minutes filled in) or by hand.
 * The page it stopped on moves the book's progress on.
 */
export function SessionDialog({
  open,
  task,
  run,
  onClose,
  onLogged,
}: {
  open: boolean;
  task: Task;
  run?: Running;
  onClose: () => void;
  /** Called with the page the session stopped on, once saved. */
  onLogged?: (pageEnd: number | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {open ? <SessionForm task={task} run={run} onClose={onClose} onLogged={onLogged} /> : null}
    </Dialog>
  );
}

function SessionForm({ task, run, onClose, onLogged }: { task: Task; run?: Running; onClose: () => void; onLogged?: (pageEnd: number | null) => void }) {
  const log = useLogSession();
  const { stop } = useRunning();
  const [minutes, setMinutes] = useState(() => (run ? String(Math.max(1, Math.round(elapsedMs(run, Date.now()) / 60_000))) : ""));
  const [page, setPage] = useState("");
  const total = task.meta.pagesTotal;
  const from = task.meta.pagesRead ?? 0;
  const mins = Number(minutes);
  const pageEnd = page.trim() ? Math.round(Number(page)) : null;
  const pageError = pageEnd !== null && (!Number.isFinite(pageEnd) || pageEnd < 0) ? "Enter a page number" : null;
  const valid = Number.isFinite(mins) && mins > 0 && !pageError;

  async function save() {
    if (!valid) return;
    const finished = await log.mutateAsync({ task, startedAt: run?.startedAt ?? Date.now() - mins * 60_000, minutes: mins, pageEnd });
    if (run) await stop();
    onLogged?.(pageEnd);
    onClose();
    const pages = pageEnd !== null ? Math.max(0, pageEnd - from) : 0;
    toast.success(`Logged ${hoursMinutes(mins)} of ${task.title}`, {
      description: pages ? `${pages} ${pages === 1 ? "page" : "pages"}` : undefined,
      action: finished ? { label: "Mark finished", onClick: () => void setTaskDone(task, true) } : undefined,
    });
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{run ? "Finish reading" : "Log a reading session"}</DialogTitle>
        <DialogDescription>{task.title}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minutes" htmlFor="read-minutes">
          <Input id="read-minutes" type="number" inputMode="numeric" min={1} value={minutes} onChange={(e) => setMinutes(e.target.value)} autoFocus={!run} />
        </Field>
        <Field label="Stopped on page" htmlFor="read-page" hint={total ? `of ${total}, was on ${from}` : from ? `was on ${from}` : "Optional"} error={pageError}>
          <Input
            id="read-page"
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={String(from || "")}
            value={page}
            onChange={(e) => setPage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            autoFocus={!!run}
          />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!valid} loading={log.isPending}>
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** Start button for a book row; shows the clock on the book being read. */
export function StartReading({ task, hue }: { task: Task; hue: string }) {
  const { running, start } = useRunning();
  const now = useNow(running?.taskId === task.id && !running.pausedAt);
  if (running?.taskId === task.id) {
    return (
      <span className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold tabular-nums" style={{ color: hue, background: `color-mix(in srgb, ${hue} 14%, transparent)` }}>
        <Timer size={14} weight="bold" />
        {clock(elapsedMs(running, now))}
      </span>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Start reading ${task.title}`}
      disabled={!!running}
      onClick={() => {
        void start(task.id);
        toast(`Reading ${task.title}`, { description: "The timer keeps going if you leave Kaizen." });
      }}
    >
      <Play weight="fill" />
      Read
    </Button>
  );
}

/** Sessions so far on one book, for the editor: totals, history and logging by hand. */
export function SessionHistory({
  task,
  sessions,
  onLogged,
}: {
  task: Task;
  sessions: ReadingSession[];
  onLogged?: (pageEnd: number | null) => void;
}) {
  const remove = useRemoveSession();
  const [logging, setLogging] = useState(false);
  const totals = totalsOf(sessions);
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">Reading sessions</span>
        <Button variant="ghost" size="sm" onClick={() => setLogging(true)}>
          <Plus />
          Log one
        </Button>
      </div>
      {sessions.length ? (
        <>
          <p className="text-muted-foreground text-[13px]">
            {totals.sessions} {totals.sessions === 1 ? "session" : "sessions"} · {hoursMinutes(totals.minutes)}
            {totals.pages ? ` · ${totals.pages} pages` : ""}
            {totals.pages && totals.minutes >= 1 ? ` · ${Math.round((totals.pages / totals.minutes) * 60)} pages an hour` : ""}
          </p>
          <ul className="border-border grid max-h-48 overflow-y-auto rounded-xl border">
            {sessions.map((s) => (
              <li key={s.id} className="border-border flex items-center gap-2 border-b px-3 py-2 text-[14px] last:border-b-0">
                <BookOpen size={15} className="text-muted-foreground shrink-0" />
                <span className="flex-1">{relativeDay(s.date)}</span>
                <span className="text-muted-foreground tabular-nums">
                  {hoursMinutes(s.minutes)}
                  {s.pages ? ` · ${s.pages} p` : ""}
                </span>
                <Button variant="ghost" size="icon-sm" aria-label="Delete session" onClick={() => remove.mutate(s.id)}>
                  <Trash />
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-muted-foreground text-[13px]">Start one with Read on the list, or log one you've had.</p>
      )}
      <SessionDialog open={logging} task={task} onClose={() => setLogging(false)} onLogged={onLogged} />
    </div>
  );
}

/** Picks a book to start reading, for the palette and the app shortcut. */
export function BookPicker({ open, books, onClose }: { open: boolean; books: Task[]; onClose: () => void }) {
  const { start } = useRunning();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start reading</DialogTitle>
        </DialogHeader>
        {books.length ? (
          <ul className="grid max-h-80 gap-1 overflow-y-auto">
            {books.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => {
                    void start(b.id);
                    onClose();
                  }}
                  className="hover:bg-surface-muted flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left"
                >
                  {b.meta.cover ? <ItemCover task={b} className="h-12 w-9" /> : <BookOpen size={20} className="text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">{b.title}</span>
                    <span className="text-muted-foreground block text-[12px]">
                      {b.status === "in_progress" ? "Reading" : "Planned"}
                      {b.meta.pagesTotal ? ` · page ${b.meta.pagesRead ?? 0} of ${b.meta.pagesTotal}` : ""}
                    </span>
                  </span>
                  <Play size={16} weight="fill" className="text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-[14px]">Add a book to the read list first.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** For Today: the book being read, its progress and time read today. */
export function ReadingGlance({ hue }: { hue: string }) {
  const books = useTasks("read");
  const sessions = useReadingSessions();
  const { running } = useRunning();
  const today = todayKey();
  const open = (books.data ?? []).filter((b) => b.status !== "done");
  const lastRead = new Map<string, number>();
  for (const s of sessions.data ?? []) lastRead.set(s.taskId, Math.max(lastRead.get(s.taskId) ?? 0, s.startedAt));
  const book =
    open.find((b) => b.id === running?.taskId) ??
    open.filter((b) => b.status === "in_progress").sort((a, b) => (lastRead.get(b.id) ?? 0) - (lastRead.get(a.id) ?? 0))[0] ??
    open[0];
  const minutesToday = (sessions.data ?? []).filter((s) => s.date === today).reduce((n, s) => n + s.minutes, 0);
  if (!book) return <p className="text-muted-foreground text-[14px] leading-relaxed">Add a book to the read list and time your sessions here.</p>;
  const total = book.meta.pagesTotal;
  const at = book.meta.pagesRead ?? 0;
  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="flex items-start gap-3">
        {book.meta.cover ? <ItemCover task={book} className="h-16 w-11" /> : null}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-[15px] leading-snug font-medium">{book.title}</p>
          {book.meta.author ? <p className="text-muted-foreground truncate text-[13px]">{book.meta.author}</p> : null}
        </div>
      </div>
      {total ? (
        <div className="flex items-center gap-2.5">
          <div className="bg-surface-muted h-1.5 flex-1 overflow-hidden rounded-full">
            <div className="h-full rounded-full" style={{ width: `${Math.min(1, at / total) * 100}%`, background: hue }} />
          </div>
          <span className="text-muted-foreground text-[12px] tabular-nums">
            {at}/{total}
          </span>
        </div>
      ) : null}
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[13px]">{minutesToday >= 1 ? `${hoursMinutes(minutesToday)} today` : "Not yet today"}</span>
        <StartReading task={book} hue={hue} />
      </div>
    </div>
  );
}
