import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookOpen, Camera, CheckCircle, FilmStrip, Scribble, type Icon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/kit";
import { parseTask } from "@/core/nl/parse";
import { formatLongDate, todayKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { createBoardWithImage } from "@/modules/canvas/data";
import { useAddPhotos } from "@/modules/fitness/data";
import { useAddTask } from "@/modules/lists/data";
import { pathOf } from "@/modules/registry";
import { guessKind, useCapture, type CaptureDraft } from "./store";

type TextKind = "task" | "watch" | "read";
type ImageKind = "board" | "photo";

const TEXT_KINDS: { id: TextKind; label: string; icon: Icon }[] = [
  { id: "task", label: "Task", icon: CheckCircle },
  { id: "watch", label: "To watch", icon: FilmStrip },
  { id: "read", label: "To read", icon: BookOpen },
];

const IMAGE_KINDS: { id: ImageKind; label: string; icon: Icon }[] = [
  { id: "board", label: "New board", icon: Scribble },
  { id: "photo", label: "Progress photo", icon: Camera },
];

const listOf = (k: TextKind) => (k === "task" ? "todo" : k);

function Chip({
  active,
  onClick,
  icon: IconCmp,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: Icon;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
        active ? "bg-foreground text-background border-transparent" : "border-border hover:bg-surface-muted",
      )}
    >
      <IconCmp size={15} weight={active ? "fill" : "regular"} />
      {label}
    </button>
  );
}

function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** One box for anything: a task (with dates in plain words), something to watch or read, or a shared image. */
export function QuickCapture() {
  const draft = useCapture((s) => s.draft);
  const seq = useCapture((s) => s.seq);
  const close = useCapture((s) => s.close);
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && close()}>
      {draft ? <CaptureForm key={seq} draft={draft} close={close} /> : null}
    </Dialog>
  );
}

function CaptureForm({ draft, close }: { draft: CaptureDraft; close: () => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const addTask = useAddTask();
  const addPhotos = useAddPhotos();
  const [text, setText] = useState(draft.text ?? "");
  const [kind, setKind] = useState<TextKind>(draft.kind || (draft.text ? guessKind(draft.text) : "task"));
  const [imageKind, setImageKind] = useState<ImageKind>("board");
  const [saving, setSaving] = useState(false);
  const image = draft.image ?? null;

  const parsed = useMemo(() => parseTask(text, new Date(), listOf(kind)), [text, kind]);
  const preview = parsed
    ? [
        parsed.dueDate ? `${formatLongDate(parsed.dueDate)}${parsed.dueTime ? `, ${parsed.dueTime}` : ""}` : null,
        parsed.recurrence ? `every ${parsed.recurrence.replace("ly", "").replace("dai", "day")}` : null,
        parsed.priority ? "!".repeat(parsed.priority) : null,
        ...parsed.tags.map((t) => `#${t}`),
      ].filter(Boolean)
    : [];

  async function save() {
    setSaving(true);
    try {
      if (image) {
        if (imageKind === "board") {
          const mime = image.slice(5, image.indexOf(";"));
          const id = await createBoardWithImage(text.trim() || "Shared image", {
            dataUrl: image,
            mime,
            ...(await imageSize(image)),
          });
          await client.invalidateQueries({ queryKey: ["boards"] });
          close();
          void navigate({ to: "/canvas/board", search: { b: id } });
          return;
        }
        const blob = await (await fetch(image)).blob();
        await addPhotos.mutateAsync({ date: todayKey(), files: [new File([blob], "shared.jpg", { type: blob.type })] });
        toast.success("Progress photo saved", {
          action: { label: "Open", onClick: () => void navigate({ to: "/fitness/body" }) },
        });
      } else {
        const p = parseTask(text, new Date(), listOf(kind));
        await addTask.mutateAsync({ ...p, list: listOf(kind), title: p.title || text.trim() });
        const where = kind === "task" ? "To-do" : kind === "watch" ? "To watch" : "To read";
        toast.success(`Added to ${where}`, {
          description: p.title || text.trim(),
          action: { label: "Open", onClick: () => void navigate({ to: pathOf("lists") }) },
        });
      }
      close();
    } catch (e) {
      toast.error(`Could not save: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setSaving(false);
    }
  }

  const canSave = image ? true : text.trim().length > 0;

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{image ? "Save image" : "Capture"}</DialogTitle>
      </DialogHeader>

      {image ? (
        <div className="grid gap-3">
          <img src={image} alt="Shared" className="bg-surface-muted max-h-64 w-full rounded-xl object-contain" />
          <div className="flex flex-wrap gap-1.5">
            {IMAGE_KINDS.map((k) => (
              <Chip
                key={k.id}
                active={imageKind === k.id}
                onClick={() => setImageKind(k.id)}
                icon={k.icon}
                label={k.label}
              />
            ))}
          </div>
          {imageKind === "board" ? (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Board name"
              className="border-border bg-surface focus:border-foreground/30 h-10 rounded-xl border px-3 text-[14px] outline-none"
            />
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-1.5">
            {TEXT_KINDS.map((k) => (
              <Chip key={k.id} active={kind === k.id} onClick={() => setKind(k.id)} icon={k.icon} label={k.label} />
            ))}
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                if (canSave) void save();
              }
            }}
            placeholder={
              kind === "task"
                ? "Submit OS assignment friday 5pm #college"
                : kind === "watch"
                  ? "Dune Part Two"
                  : "Atomic Habits"
            }
            className="min-h-20"
            autoFocus
          />
          {preview.length ? <p className="text-muted-foreground text-[13px]">{preview.join(" · ")}</p> : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-muted-foreground hidden text-[12px] sm:inline">
          {image ? "" : "Enter to save"}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
