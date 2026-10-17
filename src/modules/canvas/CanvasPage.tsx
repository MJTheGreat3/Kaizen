import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { MagnifyingGlass, PencilSimple, Plus, PushPin, PushPinSlash, Scribble, Trash } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { EmptyState, RowMenu } from "@/components/ui/kit";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { useOpenTarget } from "@/core/shell/openRequest";
import { ease, rise } from "@/lib/motion";
import { timeAgo } from "@/lib/utils";
import { modules } from "@/modules/registry";
import { createBoard, useBoards, useRemoveBoard, useRestoreBoard, useUpdateBoard, type BoardSummary } from "./data";
import { RenameDialog } from "./parts";

const mod = modules.find((m) => m.id === "canvas")!;
const HUE = mod.hue;

function BoardCard({ board, now, onRename }: { board: BoardSummary; now: number; onRename: (b: BoardSummary) => void }) {
  const navigate = useNavigate();
  const update = useUpdateBoard();
  const remove = useRemoveBoard();
  const restore = useRestoreBoard();
  const open = () => void navigate({ to: "/canvas/board", search: { b: board.id } });

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, ease }}
      className="group relative overflow-hidden rounded-2xl border border-border bg-surface shadow-soft transition-shadow hover:shadow-float"
    >
      <button type="button" onClick={open} className="block w-full text-left" aria-label={`Open ${board.title}`}>
        <span className="grid aspect-[16/10] place-items-center overflow-hidden border-b border-border/70 bg-surface-muted/60 p-3">
          {board.preview ? (
            <img src={board.preview} alt="" className="max-h-full max-w-full object-contain dark:[filter:invert(93%)_hue-rotate(180deg)]" />
          ) : (
            <Scribble size={34} weight="duotone" className="text-muted-foreground/50" />
          )}
        </span>
      </button>
      <div className="flex items-start gap-2 p-3 pl-4">
        <button type="button" onClick={open} className="grid min-w-0 flex-1 gap-0.5 text-left">
          <span className="flex items-center gap-1.5 text-[15px] font-medium">
            {board.pinned ? <PushPin size={13} weight="fill" className="shrink-0 text-muted-foreground" /> : null}
            <span className="truncate">{board.title}</span>
          </span>
          <span className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
            {board.shapes ? `${board.shapes} ${board.shapes === 1 ? "shape" : "shapes"}` : "Empty"} · {timeAgo(board.updatedAt, now)}
          </span>
        </button>
        <RowMenu
          items={[
            board.pinned
              ? { label: "Unpin", icon: PushPinSlash, onSelect: () => update.mutate({ id: board.id, patch: { pinned: false } }) }
              : { label: "Pin", icon: PushPin, onSelect: () => update.mutate({ id: board.id, patch: { pinned: true } }) },
            { label: "Rename", icon: PencilSimple, onSelect: () => onRename(board) },
            {
              label: "Delete",
              icon: Trash,
              danger: true,
              onSelect: async () => {
                await remove.mutateAsync(board.id);
                toast(`Deleted "${board.title}"`, { action: { label: "Undo", onClick: () => restore.mutate(board.id) } });
              },
            },
          ]}
        />
      </div>
    </motion.article>
  );
}

/** Every board, newest first; each opens full screen. */
export function CanvasPage() {
  const { data, isLoading } = useBoards();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<BoardSummary | null>(null);
  const [creating, setCreating] = useState(false);
  const [now] = useState(() => Date.now());

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((b) => !q || b.title.toLowerCase().includes(q));
  }, [data, query]);

  async function create() {
    setCreating(true);
    try {
      const id = await createBoard("Untitled board");
      await navigate({ to: "/canvas/board", search: { b: id } });
    } finally {
      setCreating(false);
    }
  }

  useOpenTarget(["canvas"], !!data, ({ id }) => {
    if (id === "new") void create();
    else void navigate({ to: "/canvas/board", search: { b: id } });
  });

  return (
    <Page hue={HUE} className="max-w-[1100px]">
      <PageHeader
        title="Canvas"
        description="Boards to sketch, plan and think on."
        icon={mod.icon}
        hue={HUE}
        actions={
          <Button size="sm" onClick={create} loading={creating}>
            <Plus />
            New board
          </Button>
        }
      />

      {data && data.length > 6 ? (
        <motion.label variants={rise} className="mt-8 flex h-10 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 shadow-soft">
          <MagnifyingGlass size={16} className="text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search boards" className="flex-1 bg-transparent text-[14px] outline-none" />
        </motion.label>
      ) : null}

      <motion.div variants={rise} className="mt-8">
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="aspect-[16/12] rounded-2xl" />
            ))}
          </div>
        ) : !data?.length ? (
          <EmptyState
            icon={Scribble}
            hue={HUE}
            title="A blank canvas"
            action={
              <Button onClick={create} loading={creating}>
                <Plus />
                New board
              </Button>
            }
          >
            Diagrams, sketches, plans and mind maps. Draw with a finger, pen or mouse.
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence initial={false}>
              {shown.map((b) => (
                <BoardCard key={b.id} board={b} now={now} onRename={setRenaming} />
              ))}
            </AnimatePresence>
            {!shown.length ? <p className="py-10 text-center text-[14px] text-muted-foreground sm:col-span-2 lg:col-span-3">No board matches.</p> : null}
          </div>
        )}
      </motion.div>

      {renaming ? <RenameDialog board={renaming} onClose={() => setRenaming(null)} /> : null}
    </Page>
  );
}
