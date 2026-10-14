import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowsClockwise,
  Barbell,
  Scribble,
  ClockCounterClockwise,
  CloudArrowUp,
  Flag,
  GearSix,
  Lightbulb,
  ListPlus,
  Lock,
  MagnifyingGlass,
  MoonStars,
  Plus,
  Target,
  Tree,
  X,
  type Icon,
} from "@phosphor-icons/react";
import { toast } from "sonner";

import { Kbd } from "@/components/ui/controls";
import { ModuleTile } from "@/components/visual";
import { runBackupNow } from "@/core/backup/useScheduledBackup";
import { db, schema } from "@/core/db/client";
import { usePref } from "@/core/db/prefs";
import { parseTask } from "@/core/nl/parse";
import { moduleOf, SEARCH_MODULES, useSearchRows } from "@/core/search/data";
import { highlight, labelScore, parseQuery, search, type Result } from "@/core/search/match";
import { useSession } from "@/core/security/session";
import { useSyncAction } from "@/core/sync/useSyncAction";
import { cycleTheme } from "@/core/theme";
import { relativeDay } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { useAddTask } from "@/modules/lists/data";
import { modules, pathOf } from "@/modules/registry";
import { useOpenRequest } from "./openRequest";
import { usePalette } from "./palette";

const itemClass =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-1.5 text-[14px] text-foreground transition-colors data-[selected=true]:bg-surface-muted [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-muted-foreground";
const groupClass =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground";

interface Action {
  id: string;
  label: string;
  /** Extra words it answers to. */
  keywords?: string;
  icon: Icon;
  run: () => void | Promise<void>;
}

const STATUS_LABEL: Record<string, string> = {
  done: "Done",
  in_progress: "In progress",
  archived: "Archived",
  pinned: "Pinned",
  owed_to_me: "Owes you",
  solved: "Solved",
  attempted: "Not solved",
  i_owe: "You owe",
};

function subtitle(r: Result) {
  const { row } = r;
  const parts: string[] = [];
  if (row.status && STATUS_LABEL[row.status]) parts.push(STATUS_LABEL[row.status]);
  if (row.amount !== null) parts.push(row.src === "debts" ? formatPaise(Math.round(row.amount * 100)) : `${Math.round(row.amount)}`);
  if (row.src === "debts" && row.body) parts.push(row.body.split(" ")[0]);
  // Books and shows: the author or medium says more than when they were added.
  if ((row.module === "read" || row.module === "watch") && row.body) parts.push(row.body.slice(0, 60));
  else if (row.date && row.src !== "habits") parts.push(relativeDay(row.date));
  if (!parts.length && row.body && row.src !== "ideas") parts.push(row.body.slice(0, 60));
  return parts.join(" · ");
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  return (
    <>
      {highlight(text, ranges).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-accent/20 text-foreground">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette() {
  const { open, setOpen } = usePalette();
  const navigate = useNavigate();
  const client = useQueryClient();
  const lock = useSession((s) => s.lock);
  const sync = useSyncAction();
  const addTask = useAddTask();
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const rows = useSearchRows(open);
  const [recent, setRecent] = usePref("search.recent");
  const [opened, setOpened] = usePref("search.opened");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!usePalette.getState().open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  function close(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function run(action: () => void | Promise<void>) {
    close(false);
    void Promise.resolve(action()).catch((e) => toast.error(String(e)));
  }

  function rememberSearch() {
    const q = query.trim();
    if (q.length >= 2) void setRecent([q, ...recent.filter((x) => x !== q)].slice(0, 6));
  }

  function openItem(module: string, id: string, title: string) {
    const { module: mod } = moduleOf(module);
    void setOpened([{ module, id, title }, ...opened.filter((x) => !(x.module === module && x.id === id))].slice(0, 6));
    run(() => {
      useOpenRequest.getState().request({ module, id });
      return navigate({ to: mod?.path ?? "/" });
    });
  }

  const actions: Action[] = useMemo(
    () => [
      {
        id: "focus",
        label: "Start a focus session",
        keywords: "timer pomodoro tree",
        icon: Tree,
        run: () => {
          useOpenRequest.getState().request({ module: "focus", id: "start" });
          return navigate({ to: pathOf("focus") });
        },
      },
      {
        id: "workout",
        label: "Log a workout",
        keywords: "gym start lift exercise",
        icon: Barbell,
        run: () => {
          useOpenRequest.getState().request({ module: "fitness", id: "start" });
          return navigate({ to: pathOf("fitness") });
        },
      },
      {
        id: "board",
        label: "New board",
        keywords: "canvas whiteboard draw sketch excalidraw",
        icon: Scribble,
        run: () => {
          useOpenRequest.getState().request({ module: "canvas", id: "new" });
          return navigate({ to: pathOf("canvas") });
        },
      },
      {
        id: "goal",
        label: "New goal",
        keywords: "target",
        icon: Flag,
        run: () => {
          useOpenRequest.getState().request({ module: "goals", id: "new" });
          return navigate({ to: pathOf("goals") });
        },
      },
      {
        id: "habit",
        label: "New habit",
        icon: Target,
        run: () => {
          useOpenRequest.getState().request({ module: "habits", id: "new" });
          return navigate({ to: pathOf("habits") });
        },
      },
      { id: "sync", label: "Sync now", keywords: "drive devices", icon: ArrowsClockwise, run: () => sync.mutate() },
      {
        id: "backup",
        label: "Back up now",
        keywords: "backup",
        icon: CloudArrowUp,
        run: async () => {
          const id = toast.loading("Backing up…");
          try {
            await runBackupNow();
            toast.success("Backup saved", { id });
          } catch (e) {
            toast.error(`Backup failed: ${String(e)}`, { id });
          }
        },
      },
      { id: "theme", label: "Toggle dark mode", keywords: "theme light", icon: MoonStars, run: cycleTheme },
      { id: "lock", label: "Lock now", icon: Lock, run: lock },
    ],
    [navigate, sync, lock],
  );

  const parsed = useMemo(() => parseQuery(deferred), [deferred]);
  const results = useMemo(() => (rows.data ? search(rows.data, parsed) : []), [rows.data, parsed]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Result[]>();
    for (const r of results) {
      if (!groups.has(r.row.module)) groups.set(r.row.module, []);
      groups.get(r.row.module)!.push(r);
    }
    // Groups in order of their best result; at most 6 rows each.
    return [...groups].map(([module, items]) => ({ module, items: items.slice(0, 6), more: items.length - 6 }));
  }, [results]);

  const searching = query.trim().length > 0;
  const terms = parsed.terms;
  const goTo = [...modules.map((m) => ({ id: m.id, label: m.title, summary: m.summary, path: m.path, m })), { id: "settings", label: "Settings", summary: "", path: "/settings", m: null }];
  const matchedGoTo = searching ? goTo.filter((g) => terms.length && labelScore(`${g.label} ${g.id}`, terms) > 0).slice(0, 4) : goTo;
  const matchedActions = searching ? actions.filter((a) => terms.length && labelScore(`${a.label} ${a.keywords ?? ""}`, terms) > 0) : actions;
  const plainText = query.trim() && !parsed.filtered ? query.trim() : "";

  async function quickTask() {
    const p = parseTask(plainText, new Date(), "todo");
    if (!p.title) return;
    await addTask.mutateAsync(p);
    toast.success(`Added to ${p.list === "todo" ? "To-do" : p.list === "watch" ? "Watch" : "Read"}`, { description: p.title });
  }

  async function quickIdea() {
    const tags = [...new Set([...plainText.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()))];
    await db.insert(schema.ideas).values({ body: plainText, tags });
    await client.invalidateQueries({ queryKey: ["ideas"] });
    toast.success("Idea saved");
  }

  const goToGroup = matchedGoTo.length ? (
    <Command.Group heading="Go to" className={groupClass}>
      {matchedGoTo.map((g) => (
        <Command.Item key={g.id} value={`go:${g.id}`} onSelect={() => run(() => navigate({ to: g.path }))} className={itemClass}>
          {g.m ? <ModuleTile icon={g.m.icon} hue={g.m.hue} size="sm" /> : <GearSix />}
          <span className="flex-1">{g.label}</span>
          {g.summary ? <span className="hidden truncate text-[12px] text-muted-foreground sm:inline">{g.summary}</span> : null}
        </Command.Item>
      ))}
    </Command.Group>
  ) : null;

  const actionGroup =
    matchedActions.length || plainText ? (
      <Command.Group heading="Actions" className={groupClass}>
        {plainText ? (
          <>
            <Command.Item value="quick:task" onSelect={() => run(quickTask)} className={itemClass}>
              <ListPlus />
              <span className="min-w-0 flex-1 truncate">
                Add task <span className="text-muted-foreground">“{plainText}”</span>
              </span>
            </Command.Item>
            <Command.Item value="quick:idea" onSelect={() => run(quickIdea)} className={itemClass}>
              <Lightbulb />
              <span className="min-w-0 flex-1 truncate">
                Save idea <span className="text-muted-foreground">“{plainText}”</span>
              </span>
            </Command.Item>
          </>
        ) : null}
        {matchedActions.map((a) => (
          <Command.Item key={a.id} value={`action:${a.id}`} onSelect={() => run(a.run)} className={itemClass}>
            <a.icon />
            {a.label}
          </Command.Item>
        ))}
      </Command.Group>
    ) : null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={close}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[max(12dvh,calc(env(safe-area-inset-top)+1rem))] z-50 w-[calc(100%-2rem)] max-w-[600px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">Search and commands</DialogPrimitive.Title>
          <Command loop shouldFilter={false} className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <MagnifyingGlass size={18} className="shrink-0 text-muted-foreground" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search everything, or type a command…"
                className="h-13 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
              {query ? (
                <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <X size={16} />
                </button>
              ) : (
                <Kbd className="hidden sm:inline-flex">esc</Kbd>
              )}
            </div>
            <Command.List className="max-h-[min(62dvh,480px)] overflow-y-auto p-2">
              {searching ? (
                <>
                  {!grouped.length && !matchedGoTo.length && !matchedActions.length && !plainText ? (
                    <p className="px-3 py-8 text-center text-[14px] text-muted-foreground">{rows.isLoading ? "Searching…" : "Nothing matches."}</p>
                  ) : null}
                  {goToGroup}
                  {grouped.map(({ module, items, more }) => {
                    const { info, module: mod } = moduleOf(module);
                    return (
                      <Command.Group key={module} heading={info?.label ?? module} className={groupClass}>
                        {items.map((r) => (
                          <Command.Item
                            key={`${r.row.src}:${r.row.refId}`}
                            value={`${r.row.src}:${r.row.refId}`}
                            onSelect={() => {
                              rememberSearch();
                              openItem(r.row.module, r.row.refId, r.row.title);
                            }}
                            className={itemClass}
                          >
                            {mod ? <ModuleTile icon={mod.icon} hue={mod.hue} size="sm" /> : null}
                            <span className="grid min-w-0 flex-1">
                              <span className="truncate">
                                <Highlighted text={r.row.title} ranges={r.ranges} />
                              </span>
                              {subtitle(r) ? <span className="truncate text-[12px] text-muted-foreground">{subtitle(r)}</span> : null}
                            </span>
                            {r.row.tags ? (
                              <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">
                                {r.row.tags
                                  .split(" ")
                                  .slice(0, 2)
                                  .map((t) => `#${t}`)
                                  .join(" ")}
                              </span>
                            ) : null}
                          </Command.Item>
                        ))}
                        {more > 0 ? (
                          <p className="px-3 pb-1 text-[12px] text-muted-foreground">
                            {more} more, try <code className="font-mono">in:{module === "todo" ? "tasks" : module}</code> or more words
                          </p>
                        ) : null}
                      </Command.Group>
                    );
                  })}
                  {actionGroup}
                </>
              ) : (
                <>
                  {opened.length ? (
                    <Command.Group heading="Recently opened" className={groupClass}>
                      {opened.map((o) => {
                        const { module: mod } = moduleOf(o.module);
                        return (
                          <Command.Item key={`${o.module}:${o.id}`} value={`opened:${o.module}:${o.id}`} onSelect={() => openItem(o.module, o.id, o.title)} className={itemClass}>
                            {mod ? <ModuleTile icon={mod.icon} hue={mod.hue} size="sm" /> : null}
                            <span className="min-w-0 flex-1 truncate">{o.title}</span>
                            <span className="text-[12px] text-muted-foreground">{SEARCH_MODULES[o.module]?.label}</span>
                          </Command.Item>
                        );
                      })}
                    </Command.Group>
                  ) : null}
                  {recent.length ? (
                    <Command.Group heading="Recent searches" className={groupClass}>
                      {recent.map((q) => (
                        <Command.Item key={q} value={`recent:${q}`} onSelect={() => setQuery(q)} className={itemClass}>
                          <ClockCounterClockwise />
                          <span className="flex-1 truncate">{q}</span>
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ) : null}
                  {actionGroup}
                  {goToGroup}
                </>
              )}
            </Command.List>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <Plus size={12} className="-mr-2" />
              {["in:ideas", "tag:college", "#dsa", "amount:>500", "rating:>1600", "before:2026-09", "is:done"].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  onClick={() => setQuery((q) => (q.trim() ? `${q.trim()} ${hint} ` : `${hint} `))}
                  className="font-mono hover:text-foreground"
                >
                  {hint}
                </button>
              ))}
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
