import { useMemo, useState } from "react";
import { Star, Trash } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DateTimeInput, Textarea } from "@/components/ui/kit";
import type { Recurrence, Task, TaskList } from "@/core/db/schema";
import { cn } from "@/lib/utils";
import { modules } from "@/modules/registry";
import { useDeleteTask, useTasks, useUpdateTask } from "./data";
import { DetailsFinder } from "./DetailsFinder";
import { byBook, useReadingSessions } from "./reading";
import { SessionHistory } from "./ReadingSession";
import { recurrenceLabel } from "./recurrence";
import { buildTree, canNest } from "./subtasks";
import { SubtaskChecklist } from "./SubtaskParts";

const HUE = modules.find((m) => m.id === "lists")!.hue;

export function TaskEditor({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const update = useUpdateTask();
  const remove = useDeleteTask();
  const sessions = useReadingSessions();
  const todos = useTasks("todo");
  const tree = useMemo(() => buildTree(todos.data ?? []), [todos.data]);
  // Remounted per task (keyed by id), so state starts from the task.
  const [draft, setDraft] = useState<Task | null>(task);
  const [tagText, setTagText] = useState(task?.tags.join(", ") ?? "");

  if (!draft) return null;
  const set = <K extends keyof Task>(key: K, value: Task[K]) => setDraft({ ...draft, [key]: value });
  const setMeta = (patch: Partial<Task["meta"]>) => setDraft({ ...draft, meta: { ...draft.meta, ...patch } });

  async function save() {
    if (!draft || !draft.title.trim()) return;
    const tags = tagText
      .split(",")
      .map((s) => s.trim().replace(/^#/, "").toLowerCase())
      .filter(Boolean);
    await update.mutateAsync({
      id: draft.id,
      list: draft.list,
      title: draft.title.trim(),
      notes: draft.notes?.trim() || null,
      dueDate: draft.dueDate || null,
      dueTime: draft.dueDate ? draft.dueTime || null : null,
      remind: draft.remind,
      recurrence: draft.recurrence,
      priority: draft.priority,
      tags,
      meta: draft.meta,
      status: draft.status,
      completedAt: draft.status === "done" ? (draft.completedAt ?? Date.now()) : null,
    });
    onClose();
  }

  return (
    <Dialog open={!!task} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Title" htmlFor="task-title">
            <Input id="task-title" value={draft.title} onChange={(e) => set("title", e.target.value)} />
          </Field>

          <div className="grid gap-2">
            <span className="text-[13px] font-medium">List</span>
            <Segmented<TaskList>
              label="List"
              value={draft.list}
              onChange={(v) => set("list", v)}
              options={[
                { value: "todo", label: "To-do" },
                { value: "watch", label: "Watch" },
                { value: "read", label: "Read" },
              ]}
            />
          </div>

          {draft.list !== "todo" ? (
            <div className="grid gap-2">
              <span className="text-[13px] font-medium">Status</span>
              <Segmented<Task["status"]>
                label="Status"
                value={draft.status}
                onChange={(v) => set("status", v)}
                options={[
                  { value: "open", label: "Planned" },
                  { value: "in_progress", label: draft.list === "read" ? "Reading" : "Watching" },
                  { value: "done", label: "Finished" },
                ]}
              />
            </div>
          ) : null}

          {draft.list !== "todo" ? (
            <DetailsFinder
              key={draft.list}
              list={draft.list}
              title={draft.title}
              meta={draft.meta}
              onPick={(meta, title) => setDraft({ ...draft, meta, title: draft.title.trim() ? draft.title : title })}
            />
          ) : null}

          {draft.list === "read" ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Author" htmlFor="task-author" className="col-span-3 sm:col-span-1">
                <Input id="task-author" value={draft.meta.author ?? ""} onChange={(e) => setMeta({ author: e.target.value })} />
              </Field>
              <Field label="Pages read" htmlFor="task-read">
                <Input
                  id="task-read"
                  inputMode="numeric"
                  value={draft.meta.pagesRead ?? ""}
                  onChange={(e) => setMeta({ pagesRead: Number(e.target.value) || undefined })}
                />
              </Field>
              <Field label="Total pages" htmlFor="task-total">
                <Input
                  id="task-total"
                  inputMode="numeric"
                  value={draft.meta.pagesTotal ?? ""}
                  onChange={(e) => setMeta({ pagesTotal: Number(e.target.value) || undefined })}
                />
              </Field>
            </div>
          ) : null}

          {draft.list === "read" && task?.list === "read" ? (
            <SessionHistory
              task={draft}
              sessions={byBook(sessions.data).get(draft.id) ?? []}
              onLogged={(pageEnd) =>
                setDraft({
                  ...draft,
                  status: draft.status === "open" ? "in_progress" : draft.status,
                  meta: pageEnd !== null ? { ...draft.meta, pagesRead: Math.max(pageEnd, draft.meta.pagesRead ?? 0) } : draft.meta,
                })
              }
            />
          ) : null}

          {draft.list === "watch" ? (
            <Field label="Cast or studio" htmlFor="task-creator">
              <Input id="task-creator" value={draft.meta.creator ?? ""} onChange={(e) => setMeta({ creator: e.target.value || undefined })} />
            </Field>
          ) : null}

          {draft.list !== "todo" ? (
            <Field label="Year" htmlFor="task-year">
              <Input id="task-year" inputMode="numeric" value={draft.meta.year ?? ""} onChange={(e) => setMeta({ year: Number(e.target.value) || undefined })} />
            </Field>
          ) : null}

          {draft.list === "watch" ? (
            <Field label="Type" htmlFor="task-medium">
              <NativeSelect id="task-medium" value={draft.meta.medium ?? ""} onChange={(e) => setMeta({ medium: e.target.value || undefined })}>
                <option value="">Not set</option>
                <option value="movie">Movie</option>
                <option value="show">Show</option>
                <option value="anime">Anime</option>
                <option value="documentary">Documentary</option>
                <option value="video">Video</option>
              </NativeSelect>
            </Field>
          ) : null}

          {draft.list !== "todo" && draft.status === "done" ? (
            <div className="grid gap-2">
              <span className="text-[13px] font-medium">Rating</span>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} stars`}
                    onClick={() => setMeta({ rating: draft.meta.rating === n ? undefined : n })}
                    className="transition-transform active:scale-90"
                  >
                    <Star
                      size={26}
                      weight={(draft.meta.rating ?? 0) >= n ? "fill" : "regular"}
                      className={cn((draft.meta.rating ?? 0) >= n ? "text-[#d4b62c]" : "text-muted-foreground")}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date" htmlFor="task-date">
              <DateTimeInput id="task-date" type="date" value={draft.dueDate ?? ""} onChange={(e) => set("dueDate", e.target.value || null)} />
            </Field>
            <Field label="Time" htmlFor="task-time">
              <DateTimeInput
                id="task-time"
                type="time"
                disabled={!draft.dueDate}
                value={draft.dueTime ?? ""}
                onChange={(e) => set("dueTime", e.target.value || null)}
              />
            </Field>
          </div>

          {draft.dueDate ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repeat" htmlFor="task-repeat">
                <NativeSelect
                  id="task-repeat"
                  className="w-full"
                  value={draft.recurrence ?? ""}
                  onChange={(e) => set("recurrence", (e.target.value || null) as Recurrence | null)}
                >
                  <option value="">Never</option>
                  {(Object.keys(recurrenceLabel) as Recurrence[]).map((r) => (
                    <option key={r} value={r}>
                      {recurrenceLabel[r]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <label className="flex items-end justify-between gap-3 pb-2">
                <span className="text-[14px] font-medium">Remind me</span>
                <Switch checked={draft.remind} onCheckedChange={(v) => set("remind", v)} aria-label="Remind me" />
              </label>
            </div>
          ) : null}

          <div className="grid gap-2">
            <span className="text-[13px] font-medium">Priority</span>
            <Segmented<string>
              label="Priority"
              value={String(draft.priority)}
              onChange={(v) => set("priority", Number(v))}
              options={[
                { value: "0", label: "None" },
                { value: "1", label: "Low" },
                { value: "2", label: "Medium" },
                { value: "3", label: "High" },
              ]}
            />
          </div>

          <Field label="Tags" htmlFor="task-tags" hint="Separate with commas.">
            <Input id="task-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="college, os" />
          </Field>

          <Field label="Notes" htmlFor="task-notes">
            <Textarea id="task-notes" value={draft.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>

          {task?.list === "todo" && draft.list === "todo" ? (
            <SubtaskChecklist
              parentId={draft.id}
              subtasks={tree.children.get(draft.id) ?? []}
              hue={HUE}
              canAdd={canNest(tree.depth.get(draft.id) ?? 0)}
            />
          ) : null}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            variant="danger-ghost"
            onClick={async () => {
              await remove.mutateAsync(draft.id);
              onClose();
            }}
          >
            <Trash />
            Delete
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} loading={update.isPending} disabled={!draft.title.trim()}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
