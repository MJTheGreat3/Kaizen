/** The parts of an Excalidraw element that merging and storage look at. */
export interface SceneElement {
  id: string;
  type?: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  /** Last change, in ms. */
  updated?: number;
  fileId?: string | null;
  text?: string;
}

/** Deleted elements are kept this long so a device that still has them sees the deletion. */
export const KEEP_DELETED_MS = 30 * 86_400_000;

/** The newer of two copies of an element: higher version, then the lower nonce (Excalidraw's own rule). */
function newer<T extends SceneElement>(a: T, b: T): T {
  if (a.version !== b.version) return a.version > b.version ? a : b;
  return a.versionNonce <= b.versionNonce ? a : b;
}

/**
 * Merges two scenes element by element, keeping `ours` order and adding
 * elements only `theirs` has where they sat. Used when another device's copy
 * of a board arrives while it is open, and before saving over it.
 */
export function mergeElements<T extends SceneElement>(ours: readonly T[], theirs: readonly T[]): T[] {
  const other = new Map(theirs.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: T[] = [];
  const take = (e: T) => {
    seen.add(e.id);
    const o = other.get(e.id);
    out.push(o ? newer(e, o) : e);
  };
  let i = 0;
  for (const e of ours) {
    // Elements only they have go before the next element both share.
    if (other.has(e.id)) {
      for (; i < theirs.length && theirs[i].id !== e.id; i++) {
        const t = theirs[i];
        if (!seen.has(t.id) && !ours.some((x) => x.id === t.id)) {
          seen.add(t.id);
          out.push(t);
        }
      }
    }
    if (!seen.has(e.id)) take(e);
  }
  for (const t of theirs) if (!seen.has(t.id)) out.push(t);
  return out;
}

/** Drops elements deleted more than `KEEP_DELETED_MS` ago. */
export function pruneDeleted<T extends SceneElement>(elements: readonly T[], now: number): T[] {
  return elements.filter((e) => !e.isDeleted || (e.updated ?? now) > now - KEEP_DELETED_MS);
}

/** Whether two scenes hold the same versions of the same elements. */
export function sameScene(a: readonly SceneElement[], b: readonly SceneElement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((e, i) => e.id === b[i].id && e.version === b[i].version && e.versionNonce === b[i].versionNonce);
}

/** Visible elements: what the board list counts. */
export const visible = <T extends SceneElement>(elements: readonly T[]) => elements.filter((e) => !e.isDeleted);

/** Ids of the image files visible elements use. */
export function fileIds(elements: readonly SceneElement[]): Set<string> {
  return new Set(visible(elements).flatMap((e) => (e.type === "image" && e.fileId ? [e.fileId] : [])));
}
