import { lazy, Suspense, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import { ArrowLeft, CircleNotch, PencilSimple, PushPin, PushPinSlash, Scribble, Trash } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { RowMenu } from "@/components/ui/kit";
import { pathOf } from "@/modules/registry";
import { useBoard, useRemoveBoard, useRestoreBoard, useUpdateBoard } from "./data";
import { RenameDialog } from "./parts";

const Editor = lazy(() => import("./Editor"));

function Loading() {
  return (
    <div className="grid h-full place-items-center text-muted-foreground">
      <CircleNotch size={24} className="animate-spin" />
    </div>
  );
}

/** One board, full screen, over the app's navigation. */
export function BoardPage() {
  const { b } = useSearch({ from: "/canvas/board" });
  const { data, isLoading } = useBoard(b);
  const navigate = useNavigate();
  const update = useUpdateBoard();
  const remove = useRemoveBoard();
  const restore = useRestoreBoard();
  const [renaming, setRenaming] = useState(false);
  const board = data?.board;
  const back = () => void navigate({ to: pathOf("canvas") });

  return (
    <div data-no-pull className="fixed inset-0 z-40 flex flex-col bg-background pl-safe pr-safe pt-safe pb-safe">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border/70 px-2">
        <button
          type="button"
          onClick={back}
          aria-label="Back to boards"
          className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <ArrowLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => board && setRenaming(true)}
          className="min-w-0 truncate rounded-lg px-2 py-1 text-left text-[15px] font-semibold tracking-tight hover:bg-surface-muted"
        >
          {board?.title ?? ""}
        </button>
        <span className="flex-1" />
        {board ? (
          <RowMenu
            items={[
              board.pinned
                ? { label: "Unpin", icon: PushPinSlash, onSelect: () => update.mutate({ id: board.id, patch: { pinned: false } }) }
                : { label: "Pin", icon: PushPin, onSelect: () => update.mutate({ id: board.id, patch: { pinned: true } }) },
              { label: "Rename", icon: PencilSimple, onSelect: () => setRenaming(true) },
              {
                label: "Delete",
                icon: Trash,
                danger: true,
                onSelect: async () => {
                  await remove.mutateAsync(board.id);
                  back();
                  toast(`Deleted "${board.title}"`, { action: { label: "Undo", onClick: () => restore.mutate(board.id) } });
                },
              },
            ]}
          />
        ) : null}
      </header>

      <div className="relative min-h-0 flex-1">
        {isLoading ? (
          <Loading />
        ) : !data ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="grid justify-items-center gap-3">
              <Scribble size={34} weight="duotone" className="text-muted-foreground/60" />
              <p className="text-[15px] text-muted-foreground">This board was deleted or has not synced to this device yet.</p>
              <Button variant="secondary" onClick={back}>
                Back to boards
              </Button>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0">
            <Suspense fallback={<Loading />}>
              <Editor key={data.board.id} scene={data} title={data.board.title} />
            </Suspense>
          </div>
        )}
      </div>

      {renaming && board ? <RenameDialog board={board} onClose={() => setRenaming(false)} /> : null}
    </div>
  );
}
