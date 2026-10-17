import { create } from "zustand";

/** What quick capture opens with: a kind to start on, and shared text or an image. */
export interface CaptureDraft {
  kind?: "task" | "watch" | "read" | "";
  text?: string;
  /** Shared image as a data URL. */
  image?: string;
}

/**
 * Quick capture, opened from the laptop's global shortcut or menu bar icon,
 * and on the phone from a share, an app shortcut, the Quick Settings tile
 * or a widget.
 */
export const useCapture = create<{
  draft: CaptureDraft | null;
  seq: number;
  open: (d?: CaptureDraft) => void;
  close: () => void;
}>((set) => ({
  draft: null,
  /** Changes on every open, so the form starts fresh. */
  seq: 0,
  open: (draft = {}) => set((s) => ({ draft, seq: s.seq + 1 })),
  close: () => set({ draft: null }),
}));

/** Where shared text most likely belongs. */
export function guessKind(text: string): "task" | "watch" | "read" {
  if (/(youtube\.com|youtu\.be|netflix\.com|imdb\.com|primevideo|hotstar|letterboxd|crunchyroll)/i.test(text))
    return "watch";
  if (/(goodreads\.com|amazon\.[a-z.]+\/.*(dp|book)|books\.google|openlibrary)/i.test(text)) return "read";
  return "task";
}
