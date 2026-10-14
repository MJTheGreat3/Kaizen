import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import { db, schema } from "@/core/db/client";
import type { Board, BoardAppState, BoardFile } from "@/core/db/schema";
import { mergeElements, pruneDeleted, type SceneElement } from "./logic";

const b = schema.boards;
const bf = schema.boardFiles;

/** A board in the list: everything but its scene. */
export type BoardSummary = Omit<Board, "elements" | "appState"> & { shapes: number };

export async function loadBoards(): Promise<BoardSummary[]> {
  return db
    .select({
      id: b.id,
      title: b.title,
      preview: b.preview,
      ideaId: b.ideaId,
      pinned: b.pinned,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      deletedAt: b.deletedAt,
      deviceId: b.deviceId,
      shapes: sql<number>`(SELECT count(*) FROM json_each(${b.elements}) WHERE NOT coalesce(json_extract(value, '$.isDeleted'), 0))`,
    })
    .from(b)
    .where(isNull(b.deletedAt))
    .orderBy(desc(b.pinned), desc(b.updatedAt));
}

export function useBoards() {
  return useQuery({ queryKey: ["boards"], queryFn: loadBoards });
}

export interface BoardScene {
  board: Board;
  files: BoardFile[];
}

async function loadBoard(id: string): Promise<BoardScene | null> {
  const [board, files] = await Promise.all([
    db.select().from(b).where(eq(b.id, id)).get(),
    db.select().from(bf).where(and(eq(bf.boardId, id), isNull(bf.deletedAt))),
  ]);
  return board && !board.deletedAt ? { board, files } : null;
}

/** One board with its scene. Refetched when sync brings changes; the editor merges them in. */
export function useBoard(id: string | undefined) {
  return useQuery({
    queryKey: ["board", id],
    queryFn: () => loadBoard(id!),
    enabled: !!id,
    refetchOnWindowFocus: false,
  });
}

function useBoardMutation<A, R>(fn: (a: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["boards"] });
      client.invalidateQueries({ queryKey: ["board"] });
      client.invalidateQueries({ queryKey: ["ideas"] });
    },
  });
}

/** Creates a board, optionally from an idea, and returns its id. */
export async function createBoard(title: string, ideaId: string | null = null): Promise<string> {
  const id = uuidv7();
  await db.insert(b).values({ id, title, ideaId });
  return id;
}

export function useCreateBoard() {
  return useBoardMutation(({ title, ideaId }: { title: string; ideaId?: string | null }) => createBoard(title, ideaId ?? null));
}

export function useUpdateBoard() {
  return useBoardMutation(({ id, patch }: { id: string; patch: Partial<Pick<Board, "title" | "pinned" | "ideaId">> }) =>
    db.update(b).set(patch).where(eq(b.id, id)),
  );
}

export function useRemoveBoard() {
  return useBoardMutation(async (id: string) => {
    const now = Date.now();
    await db.update(b).set({ deletedAt: now }).where(eq(b.id, id));
    await db.update(bf).set({ deletedAt: now }).where(eq(bf.boardId, id));
  });
}

/** Undoes a delete. */
export function useRestoreBoard() {
  return useBoardMutation(async (id: string) => {
    await db.update(b).set({ deletedAt: null }).where(eq(b.id, id));
    await db.update(bf).set({ deletedAt: null }).where(eq(bf.boardId, id));
  });
}

export interface SceneSave {
  elements: readonly SceneElement[];
  appState: BoardAppState;
  /** New image files, by Excalidraw file id. */
  files: { id: string; mime: string; data: string }[];
  /** A new preview (null once the board is empty); left as is when undefined. */
  preview?: string | null;
}

/**
 * Saves the editor's scene, merged with what is stored (another device's
 * edits may have arrived since it was loaded). Returns the merged elements
 * so the editor can take in anything it did not have.
 */
export async function saveScene(id: string, save: SceneSave): Promise<SceneElement[]> {
  const stored = await db.select({ elements: b.elements }).from(b).where(eq(b.id, id)).get();
  const merged = pruneDeleted(mergeElements(save.elements, (stored?.elements ?? []) as SceneElement[]), Date.now());
  await db
    .update(b)
    .set({ elements: merged, appState: save.appState, ...(save.preview !== undefined ? { preview: save.preview } : {}) })
    .where(eq(b.id, id));
  if (save.files.length) {
    await db
      .insert(bf)
      .values(save.files.map((f) => ({ id: f.id, boardId: id, mime: f.mime, data: f.data })))
      .onConflictDoNothing();
  }
  return merged;
}

/** Ids of files already stored, so they are not written again. */
export async function storedFileIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db.select({ id: bf.id }).from(bf).where(inArray(bf.id, ids));
  return new Set(rows.map((r) => r.id));
}

/** Boards made from ideas, by idea id. */
export function boardsByIdea(boards: BoardSummary[] | undefined): Map<string, BoardSummary> {
  const out = new Map<string, BoardSummary>();
  for (const x of boards ?? []) if (x.ideaId && !out.has(x.ideaId)) out.set(x.ideaId, x);
  return out;
}
