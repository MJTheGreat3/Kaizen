import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { BoardSummary } from "./data";
import { useUpdateBoard } from "./data";

export function RenameDialog({ board, onClose }: { board: Pick<BoardSummary, "id" | "title">; onClose: () => void }) {
  const [title, setTitle] = useState(board.title);
  const update = useUpdateBoard();
  const save = async () => {
    if (!title.trim()) return;
    await update.mutateAsync({ id: board.id, patch: { title: title.trim() } });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename board</DialogTitle>
        </DialogHeader>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          autoFocus
          aria-label="Board name"
        />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim()} loading={update.isPending} onClick={save}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
