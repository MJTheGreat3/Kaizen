import { useState } from "react";
import { Plus, Trash } from "@phosphor-icons/react";

import { CheckCircle } from "@/components/ui/kit";
import type { Task } from "@/core/db/schema";
import { parseTask } from "@/core/nl/parse";
import { cn } from "@/lib/utils";
import { useAddTask, useDeleteTask, useSetDone } from "./data";

/** A one-line field that adds subtasks under `parentId`, staying open for the next one. */
export function SubtaskInput({
  parentId,
  hue,
  onDone,
  autoFocus,
  className,
}: {
  parentId: string;
  hue: string;
  onDone?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const add = useAddTask();
  const [text, setText] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseTask(text.trim(), new Date(), "todo");
    if (!parsed.title || add.isPending) return;
    await add.mutateAsync({ ...parsed, list: "todo", parentId });
    setText("");
  }

  return (
    <form
      onSubmit={submit}
      onClick={(e) => e.stopPropagation()}
      className={cn("flex items-center gap-2.5 rounded-xl px-3 py-1.5", className)}
    >
      <Plus size={16} weight="bold" style={{ color: hue }} className="shrink-0" />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onDone?.()}
        onBlur={() => !text.trim() && onDone?.()}
        placeholder="Add a subtask"
        aria-label="New subtask"
        autoFocus={autoFocus}
        enterKeyHint="done"
        className="placeholder:text-muted-foreground/80 h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
      />
    </form>
  );
}

/** Subtasks of a task in the editor: tick, remove, add. */
export function SubtaskChecklist({
  subtasks,
  parentId,
  hue,
  canAdd,
}: {
  subtasks: Task[];
  parentId: string;
  hue: string;
  canAdd: boolean;
}) {
  const setDone = useSetDone();
  const remove = useDeleteTask();
  return (
    <div className="grid gap-1">
      <span className="text-[13px] font-medium">Subtasks</span>
      <ul className="border-border grid rounded-xl border">
        {subtasks.map((s) => (
          <li key={s.id} className="border-border/70 flex items-center gap-2.5 border-b px-3 py-2 last:border-b-0">
            <CheckCircle
              checked={s.status === "done"}
              hue={hue}
              size={20}
              label={s.status === "done" ? `Mark "${s.title}" as not done` : `Complete "${s.title}"`}
              onChange={(v) => setDone.mutate({ task: s, done: v })}
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[14px]",
                s.status === "done" && "text-muted-foreground line-through",
              )}
            >
              {s.title}
            </span>
            <button
              type="button"
              aria-label={`Delete "${s.title}"`}
              onClick={() => remove.mutate(s.id)}
              className="text-muted-foreground hover:bg-surface-muted hover:text-danger grid size-7 place-items-center rounded-lg"
            >
              <Trash size={15} />
            </button>
          </li>
        ))}
        {canAdd ? (
          <li>
            <SubtaskInput parentId={parentId} hue={hue} />
          </li>
        ) : null}
      </ul>
    </div>
  );
}
