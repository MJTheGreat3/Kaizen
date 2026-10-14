import { create } from "zustand";

interface RestState {
  endsAt: number | null;
  total: number;
  start: (seconds: number) => void;
  add: (seconds: number) => void;
  stop: () => void;
}

/** The rest timer between sets; one for the app, so it survives leaving the page. */
export const useRest = create<RestState>((set) => ({
  endsAt: null,
  total: 0,
  start: (seconds) => set({ endsAt: Date.now() + seconds * 1000, total: seconds }),
  add: (seconds) =>
    set((s) => {
      if (!s.endsAt) return s;
      const endsAt = Math.max(Date.now() + 1000, s.endsAt + seconds * 1000);
      return { endsAt, total: Math.max(1, s.total + seconds) };
    }),
  stop: () => set({ endsAt: null }),
}));
