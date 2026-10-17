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
    },
  });
}

/** Creates a board and returns its id. */
export async function createBoard(title: string): Promise<string> {
  const id = uuidv7();
  await db.insert(b).values({ id, title });
  return id;
}

/** A board holding one image (e.g. shared from another app), sized to fit about 800 px. */
export async function createBoardWithImage(title: string, image: { dataUrl: string; mime: string; width: number; height: number }): Promise<string> {
  const id = await createBoard(title);
  const fileId = uuidv7().replace(/-/g, "");
  const scale = Math.min(1, 800 / Math.max(image.width, image.height));
  const now = Date.now();
  const element = {
    id: uuidv7(),
    type: "image",
    x: 0,
    y: 0,
    width: Math.round(image.width * scale),
    height: Math.round(image.height * scale),
    angle: 0,
    strokeColor: "transparent",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    index: "a0",
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: false,
    status: "saved",
    fileId,
    scale: [1, 1],
    crop: null,
  };
  await db.update(b).set({ elements: [element] }).where(eq(b.id, id));
  await db.insert(bf).values({ id: fileId, boardId: id, mime: image.mime, data: image.dataUrl });
  return id;
}

export function useUpdateBoard() {
  return useBoardMutation(({ id, patch }: { id: string; patch: Partial<Pick<Board, "title" | "pinned">> }) =>
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
