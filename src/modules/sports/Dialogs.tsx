import { useEffect, useState } from "react";
import { Check, MagnifyingGlass, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Segmented, Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DateTimeInput, PillToggle, Textarea } from "@/components/ui/kit";
import type { SportFollow, SportId, SportSession } from "@/core/db/schema";
import { todayKey } from "@/lib/dates";
import type { SportCandidate } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useDeleteSession, useFollow, useSaveSession, useSearchSports } from "./data";
import { FOLLOW_SPORTS, INTENSITY, MAX_FAVOURITES, SESSION_SPORTS } from "./logic";
import { Avatar } from "./parts";

export function SessionDialog({ session, recent, onClose }: { session: SportSession | null; recent: string[]; onClose: () => void }) {
  const save = useSaveSession();
  const remove = useDeleteSession();
  const [sport, setSport] = useState(session?.sport ?? recent[0] ?? "Cricket");
  const [custom, setCustom] = useState("");
  const [date, setDate] = useState(session?.date ?? todayKey());
  const [minutes, setMinutes] = useState(session ? String(session.minutes) : "60");
  const [intensity, setIntensity] = useState<number | null>(session?.intensity ?? 2);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const options = [...new Set([...recent, ...SESSION_SPORTS, ...(session ? [session.sport] : [])])];
  const name = sport === "other" ? custom.trim() : sport;
  const mins = Math.round(Number(minutes));

  async function submit() {
    if (!name || !(mins > 0)) return;
    await save.mutateAsync({ id: session?.id, sport: name, date, minutes: mins, intensity, notes: notes.trim() || null });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{session ? "Edit session" : "Log a session"}</DialogTitle>
          <DialogDescription>Minutes played count towards Sports on the heatmap.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Sport" htmlFor="session-sport">
            <div id="session-sport" className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Sport">
              {[...options, "other"].map((o) => (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={sport === o}
                  onClick={() => setSport(o)}
                  className={cn(
                    "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-95",
                    sport === o ? "border-transparent bg-accent text-accent-foreground" : "border-border bg-surface text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o === "other" ? "Other…" : o}
                </button>
              ))}
            </div>
          </Field>
          {sport === "other" ? (
            <Field label="Which sport" htmlFor="session-custom">
              <Input id="session-custom" value={custom} autoFocus onChange={(e) => setCustom(e.target.value)} placeholder="Squash" />
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="session-date">
              <DateTimeInput id="session-date" type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value || todayKey())} />
            </Field>
            <Field label="Minutes" htmlFor="session-minutes">
              <Input id="session-minutes" inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          </div>
          <Field label="How hard" htmlFor="session-intensity">
            <PillToggle
              label="How hard"
              options={INTENSITY.map((l, i) => ({ value: i + 1, label: l }))}
              value={intensity ? [intensity] : []}
              onChange={(v) => setIntensity(v.filter((x) => x !== intensity)[0] ?? null)}
            />
          </Field>
          <Field label="Notes (optional)" htmlFor="session-notes">
            <Textarea id="session-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nets, 6 overs of spin" />
          </Field>
        </div>
        <DialogFooter>
          {session ? (
            <Button
              variant="danger-ghost"
              className="mr-auto"
              onClick={async () => {
                await remove.mutateAsync(session.id);
                onClose();
              }}
            >
              <Trash />
              Delete
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name || !(mins > 0)} loading={save.isPending}>
            {session ? "Save" : "Log session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}

const HINTS: Record<SportId, string> = {
  nba: "Any NBA team or player.",
  football: "Clubs and national teams from every league ESPN covers.",
  cricket: "International and league teams, current players. For anyone else, paste their Cricbuzz profile link.",
};

export function FollowDialog({
  kind: initialKind,
  follows,
  onClose,
}: {
  kind: "team" | "player";
  follows: SportFollow[];
  onClose: () => void;
}) {
  const follow = useFollow();
  const [sport, setSport] = useState<SportId>("cricket");
  const [kind, setKind] = useState(initialKind);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 350);
  const search = useSearchSports(sport, kind, debounced);
  const players = follows.filter((f) => f.kind === "player").length;
  const full = kind === "player" && players >= MAX_FAVOURITES;

  async function add(c: SportCandidate) {
    try {
      const report = await follow.mutateAsync(c);
      if (report.errors.length) toast.error(report.errors[0]);
      else toast.success(`Following ${c.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{kind === "player" ? "Add a favourite player" : "Follow a team"}</DialogTitle>
          <DialogDescription>
            {kind === "player" ? `Up to ${MAX_FAVOURITES} players, shown in the showcase with their season and career stats.` : "Fixtures and results show on the Sports page."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Segmented label="Sport" value={sport} onChange={setSport} options={FOLLOW_SPORTS.map((s) => ({ value: s.id, label: s.name }))} />
            <Segmented
              label="Kind"
              value={kind}
              onChange={setKind}
              options={[
                { value: "team", label: "Teams" },
                { value: "player", label: "Players" },
              ]}
            />
          </div>
          <div className="relative">
            <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={kind === "player" ? "Player name" : "Team name"}
              className="pl-9"
              aria-label="Search"
            />
          </div>
          <p className="text-[12px] text-muted-foreground">{HINTS[sport]}</p>
          <div className="-mx-2 max-h-[45vh] min-h-24 overflow-y-auto">
            {debounced.trim().length < 2 ? null : search.isLoading ? (
              <div className="grid gap-2 px-2">
                <p className="text-[12px] text-muted-foreground">{sport === "cricket" ? "Searching (the first cricket search loads Cricbuzz's lists)…" : "Searching…"}</p>
                <Skeleton className="h-12 rounded-xl" />
                <Skeleton className="h-12 rounded-xl" />
              </div>
            ) : search.error ? (
              <p className="px-2 py-6 text-center text-[14px] text-danger">{String(search.error instanceof Error ? search.error.message : search.error)}</p>
            ) : !search.data?.length ? (
              <p className="px-2 py-6 text-center text-[14px] text-muted-foreground">Nothing found.</p>
            ) : (
              <ul className="grid gap-0.5">
                {search.data.map((c) => {
                  const followed = follows.some((f) => f.id === c.id);
                  return (
                    <li key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                      <Avatar src={c.image} name={c.name} square={c.kind === "team"} className="size-9 text-[13px]" />
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate text-[14px] font-medium">{c.name}</span>
                        {c.subtitle ? <span className="truncate text-[12px] text-muted-foreground">{c.subtitle}</span> : null}
                      </span>
                      <Button
                        size="sm"
                        variant={followed ? "secondary" : "primary"}
                        disabled={followed || full}
                        title={full && !followed ? `The showcase holds ${MAX_FAVOURITES} players` : undefined}
                        loading={follow.isPending && follow.variables?.id === c.id}
                        onClick={() => void add(c)}
                      >
                        {followed ? <Check /> : <Plus />}
                        {followed ? "Added" : "Add"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {full ? <p className="text-[12px] text-muted-foreground">The showcase is full. Remove a player to add another.</p> : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
