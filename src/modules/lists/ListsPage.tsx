import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowClockwise,
  BookOpen,
  CalendarBlank,
  CaretDown,
  Clock,
  FilmSlate,
  Flag,
  ListChecks,
  PencilSimple,
  Star,
  Sun,
  Timer,
  Trash,
} from "@phosphor-icons/react";

import { Segmented, Skeleton } from "@/components/ui/controls";
import { CheckCircle, Chip, EmptyState, QuickAdd, RowMenu } from "@/components/ui/kit";
import type { Task, TaskList } from "@/core/db/schema";
import { parseTask } from "@/core/nl/parse";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { useOpenTarget } from "@/core/shell/openRequest";
import { addDaysKey, formatMinutes, relativeDay, timeToMinutes, todayKey } from "@/lib/dates";
import { ease, rise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { modules } from "@/modules/registry";
import { useAddTask, useDeleteTask, useSetDone, useTasks, useUpdateTask } from "./data";
import { recurrenceLabel } from "./recurrence";
import { ItemCover } from "./DetailsFinder";
import { byBook, totalsOf, useReadingSessions } from "./reading";
import { BookPicker, ReadingBar, StartReading } from "./ReadingSession";
import { hoursMinutes } from "@/modules/review/logic";
import { TaskEditor } from "./TaskEditor";

const mod = modules.find((m) => m.id === "lists")!;
const HUE = mod.hue;

const placeholders: Record<TaskList, string> = {
  todo: 'Add a task, e.g. "submit OS assignment friday 5pm #college !high"',
  watch: 'Add something to watch, e.g. "Dune part two"',
  read: 'Add a book, e.g. "Atomic Habits"',
};

const priorityTone = ["", "text-muted-foreground", "text-[#d4a02c]", "text-danger"];

function sortTasks(a: Task, b: Task) {
  const ad = a.dueDate ?? "9999";
  const bd = b.dueDate ?? "9999";
  if (ad !== bd) return ad < bd ? -1 : 1;
  const at = a.dueTime ?? "99";
  const bt = b.dueTime ?? "99";
  if (at !== bt) return at < bt ? -1 : 1;
  return b.priority - a.priority;
}

function TaskRow({ task, onEdit }: { task: Task; onEdit: (t: Task) => void }) {
  const setDone = useSetDone();
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const today = todayKey();
  const done = task.status === "done";
  const overdue = !done && task.dueDate !== null && task.dueDate < today;
  const progress =
    task.list === "read" && task.meta.pagesTotal ? Math.min(1, (task.meta.pagesRead ?? 0) / task.meta.pagesTotal) : null;
  const sessions = useReadingSessions();
  const read = task.list === "read" ? totalsOf(byBook(sessions.data).get(task.id) ?? []) : null;

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -12, transition: { duration: 0.18 } }}
      transition={{ duration: 0.35, ease }}
      onClick={() => onEdit(task)}
      className="group flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface-muted/70"
    >
      {task.list !== "todo" && task.meta.cover ? <ItemCover task={task} className="h-14 w-10" /> : null}
      <span className="pt-0.5">
        <CheckCircle
          checked={done}
          hue={HUE}
          label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
          onChange={(v) => setDone.mutate({ task, done: v })}
        />
      </span>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[15px] leading-snug transition-colors",
            done && "text-muted-foreground line-through decoration-muted-foreground/50",
          )}
        >
          {task.title}
        </p>
        {(task.dueDate || task.tags.length || task.recurrence || task.priority || task.meta.author || task.meta.creator || task.meta.year || task.meta.medium || task.meta.rating || read?.sessions) && !done ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {task.dueDate ? (
              <Chip tone={overdue ? "danger" : task.dueDate === today ? "hue" : "muted"} hue={HUE} icon={CalendarBlank}>
                {relativeDay(task.dueDate, today)}
                {task.dueTime ? `, ${formatMinutes(timeToMinutes(task.dueTime))}` : ""}
              </Chip>
            ) : null}
            {task.recurrence ? <Chip icon={ArrowClockwise}>{recurrenceLabel[task.recurrence]}</Chip> : null}
            {task.priority ? (
              <span className={cn("inline-flex items-center", priorityTone[task.priority])} aria-label={`Priority ${task.priority}`}>
                <Flag size={14} weight="fill" />
              </span>
            ) : null}
            {task.meta.author ? <Chip>{task.meta.author}</Chip> : null}
            {task.meta.creator ? <Chip className="max-w-[16rem] truncate">{task.meta.creator}</Chip> : null}
            {task.meta.year ? <Chip>{task.meta.year}</Chip> : null}
            {task.meta.medium ? <Chip className="capitalize">{task.meta.medium}</Chip> : null}
            {read?.sessions ? (
              <Chip icon={Timer}>
                {read.sessions} {read.sessions === 1 ? "session" : "sessions"} · {hoursMinutes(read.minutes)}
              </Chip>
            ) : null}
            {task.tags.map((tag) => (
              <Chip key={tag}>#{tag}</Chip>
            ))}
          </div>
        ) : null}
        {done && task.meta.rating ? (
          <div className="mt-1 flex gap-0.5 text-[#d4b62c]" aria-label={`${task.meta.rating} stars`}>
            {Array.from({ length: task.meta.rating }, (_, i) => (
              <Star key={i} size={13} weight="fill" />
            ))}
          </div>
        ) : null}
        {progress !== null && !done ? (
          <div className="mt-2 flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted">
              <motion.div
                className="h-full rounded-full"
                style={{ background: HUE }}
                initial={{ width: 0 }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.6, ease }}
              />
            </div>
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {task.meta.pagesRead ?? 0}/{task.meta.pagesTotal}
            </span>
          </div>
        ) : null}
      </div>
      {task.list === "read" && !done ? (
        <span onClick={(e) => e.stopPropagation()}>
          <StartReading task={task} hue={HUE} />
        </span>
      ) : null}
      <span className="opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <RowMenu
          items={[
            { label: "Edit", icon: PencilSimple, onSelect: () => onEdit(task) },
            ...(task.list === "todo" && !done
              ? [{ label: "Do tomorrow", icon: Sun, onSelect: () => update.mutate({ id: task.id, dueDate: addDaysKey(today, 1) }) }]
              : []),
            { label: "Delete", icon: Trash, danger: true, onSelect: () => remove.mutate(task.id) },
          ]}
        />
      </span>
    </motion.li>
  );
}

function Group({ title, tasks, onEdit, tone }: { title: string; tasks: Task[]; onEdit: (t: Task) => void; tone?: "danger" }) {
  if (!tasks.length) return null;
  return (
    <motion.section layout variants={rise} className="grid gap-1">
      <h2 className={cn("px-3 pb-1 pt-3 text-[13px] font-semibold", tone === "danger" ? "text-danger" : "text-muted-foreground")}>
        {title} <span className="font-normal opacity-70">{tasks.length}</span>
      </h2>
      <ul className="grid">
        <AnimatePresence initial={false}>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} onEdit={onEdit} />
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

function DoneGroup({ tasks, onEdit, label }: { tasks: Task[]; onEdit: (t: Task) => void; label: string }) {
  const [open, setOpen] = useState(false);
  if (!tasks.length) return null;
  return (
    <section className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
          <CaretDown size={14} weight="bold" />
        </motion.span>
        {label} <span className="font-normal opacity-70">{tasks.length}</span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease }}
            className="grid overflow-hidden"
          >
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} onEdit={onEdit} />
            ))}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function ParsedPreview({ text, list }: { text: string; list: TaskList }) {
  const p = parseTask(text, new Date(), list);
  const listLabel = { todo: "To-do", watch: "Watch", read: "Read" }[p.list];
  return (
    <>
      <Chip tone="hue" hue={HUE} icon={p.list === "watch" ? FilmSlate : p.list === "read" ? BookOpen : ListChecks}>
        {listLabel}
      </Chip>
      {p.dueDate ? <Chip icon={CalendarBlank}>{relativeDay(p.dueDate)}</Chip> : null}
      {p.dueTime ? <Chip icon={Clock}>{formatMinutes(timeToMinutes(p.dueTime))}</Chip> : null}
      {p.recurrence ? <Chip icon={ArrowClockwise}>{recurrenceLabel[p.recurrence]}</Chip> : null}
      {p.priority ? <Chip icon={Flag}>{["", "Low", "Medium", "High"][p.priority]}</Chip> : null}
      {p.tags.map((t) => (
        <Chip key={t}>#{t}</Chip>
      ))}
    </>
  );
}

export function ListsPage() {
  const [list, setList] = useState<TaskList>("todo");
  const [editing, setEditing] = useState<Task | null>(null);
  const [picking, setPicking] = useState(false);
  const all = useTasks();
  const add = useAddTask();
  const today = todayKey();

  useOpenTarget(["todo", "watch", "read"], !!all.data, ({ module, id }) => {
    if (module === "read" && id === "session") {
      setList("read");
      setPicking(true);
      return;
    }
    const task = all.data?.find((t) => t.id === id);
    if (!task) return;
    setList(task.list);
    setEditing(task);
  });

  const counts = useMemo(() => {
    const c = { todo: 0, watch: 0, read: 0 };
    for (const t of all.data ?? []) if (t.status !== "done") c[t.list]++;
    return c;
  }, [all.data]);

  const items = useMemo(() => (all.data ?? []).filter((t) => t.list === list), [all.data, list]);
  const open = items.filter((t) => t.status !== "done").sort(sortTasks);
  const done = items
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
    .slice(0, 50);
  const books = (all.data ?? []).filter((t) => t.list === "read");
  const unread = books.filter((t) => t.status !== "done").sort((a, b) => (a.status === b.status ? 0 : a.status === "in_progress" ? -1 : 1));

  return (
    <Page hue={HUE}>
      <PageHeader title="Lists" description="To-do, to-watch and to-read. Type naturally." icon={mod.icon} hue={HUE} />

      <motion.div variants={rise} className="mt-8 grid gap-4">
        <Segmented<TaskList>
          label="List"
          value={list}
          onChange={setList}
          className="w-full sm:w-auto"
          options={[
            { value: "todo", label: `To-do${counts.todo ? ` ${counts.todo}` : ""}`, icon: <ListChecks /> },
            { value: "watch", label: `Watch${counts.watch ? ` ${counts.watch}` : ""}`, icon: <FilmSlate /> },
            { value: "read", label: `Read${counts.read ? ` ${counts.read}` : ""}`, icon: <BookOpen /> },
          ]}
        />
        <QuickAdd
          key={list}
          hue={HUE}
          placeholder={placeholders[list]}
          preview={(text) => <ParsedPreview text={text} list={list} />}
          onSubmit={async (text) => {
            const parsed = parseTask(text, new Date(), list);
            if (!parsed.title) return false;
            await add.mutateAsync(parsed);
            if (parsed.list !== list) setList(parsed.list);
          }}
        />
      </motion.div>

      <ReadingBar books={books} hue={HUE} />

      <motion.div variants={rise} className="mt-4 rounded-2xl border border-border bg-surface p-2 shadow-soft">
        {all.isLoading ? (
          <div className="grid gap-2 p-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : !open.length && !done.length ? (
          <EmptyState
            icon={list === "watch" ? FilmSlate : list === "read" ? BookOpen : ListChecks}
            hue={HUE}
            title={{ todo: "Nothing to do", watch: "Nothing to watch yet", read: "No books yet" }[list]}
          >
            {
              {
                todo: 'Type above and press enter. Dates, times, #tags, !priority and "every week" are understood.',
                watch: "Movies, shows and videos you want to get to.",
                read: "Books you're reading or want to read. Press Read on one to time a session and log the page you got to.",
              }[list]
            }
          </EmptyState>
        ) : list === "todo" ? (
          <>
            <Group title="Overdue" tone="danger" tasks={open.filter((t) => t.dueDate && t.dueDate < today)} onEdit={setEditing} />
            <Group title="Today" tasks={open.filter((t) => t.dueDate === today)} onEdit={setEditing} />
            <Group title="Upcoming" tasks={open.filter((t) => t.dueDate && t.dueDate > today)} onEdit={setEditing} />
            <Group title="Someday" tasks={open.filter((t) => !t.dueDate)} onEdit={setEditing} />
            {!open.length ? <p className="px-3 py-6 text-center text-[14px] text-muted-foreground">All done.</p> : null}
            <DoneGroup tasks={done} onEdit={setEditing} label="Completed" />
          </>
        ) : (
          <>
            <Group title={list === "read" ? "Reading" : "Watching"} tasks={open.filter((t) => t.status === "in_progress")} onEdit={setEditing} />
            <Group title="Planned" tasks={open.filter((t) => t.status === "open")} onEdit={setEditing} />
            <DoneGroup tasks={done} onEdit={setEditing} label="Finished" />
          </>
        )}
      </motion.div>

      <TaskEditor key={editing?.id ?? "none"} task={editing} onClose={() => setEditing(null)} />
      <BookPicker open={picking} books={unread} onClose={() => setPicking(false)} />
    </Page>
  );
}
