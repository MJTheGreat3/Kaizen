import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { desc, eq, isNull } from "drizzle-orm";
import { Lightbulb, MagnifyingGlass, PushPin, PushPinSlash, Shuffle, Trash } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ColorPicker, EmptyState, RowMenu, Textarea } from "@/components/ui/kit";
import { db, schema } from "@/core/db/client";
import type { Idea } from "@/core/db/schema";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { ease, rise } from "@/lib/motion";
import { PALETTE } from "@/lib/palette";
import { formatDateTime } from "@/lib/utils";
import { modules } from "@/modules/registry";

const mod = modules.find((m) => m.id === "ideas")!;
const HUE = mod.hue;
const t = schema.ideas;

/** `#tags` written in the text become the idea's tags. */
function tagsOf(body: string): string[] {
  return [...new Set([...body.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1].toLowerCase()))];
}

async function loadIdeas(): Promise<Idea[]> {
  return db.select().from(t).where(isNull(t.deletedAt)).orderBy(desc(t.pinned), desc(t.updatedAt));
}

function useIdeas() {
  return useQuery({ queryKey: ["ideas"], queryFn: loadIdeas });
}

function useIdeaMutation<A>(fn: (a: A) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["ideas"] });
      client.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

/** Renders text with clickable links and highlighted tags. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+|#[\p{L}\p{N}_-]+)/gu);
  return (
    <>
      {parts.map((p, i) =>
        /^https?:\/\//.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="break-all underline decoration-current/30 underline-offset-2">
            {p.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        ) : p.startsWith("#") ? (
          <span key={i} className="font-medium" style={{ color: `color-mix(in oklch, ${HUE} 70%, var(--foreground))` }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function IdeaCard({ idea, onOpen, highlight }: { idea: Idea; onOpen: (i: Idea) => void; highlight?: boolean }) {
  const update = useIdeaMutation((patch: Partial<Idea>) => db.update(t).set(patch).where(eq(t.id, idea.id)));
  const remove = useIdeaMutation(() => db.update(t).set({ deletedAt: Date.now() }).where(eq(t.id, idea.id)));
  const tint = idea.color ?? null;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.35, ease }}
      onClick={() => onOpen(idea)}
      className="group relative mb-3 cursor-pointer break-inside-avoid rounded-2xl border border-border bg-surface p-4 shadow-soft transition-shadow hover:shadow-float"
      style={{
        background: tint ? `color-mix(in oklch, ${tint} 10%, var(--surface))` : undefined,
        borderColor: highlight ? HUE : tint ? `color-mix(in oklch, ${tint} 30%, var(--border))` : undefined,
      }}
    >
      {idea.pinned ? <PushPin size={14} weight="fill" className="absolute right-3 top-3 text-muted-foreground" /> : null}
      <p className="whitespace-pre-wrap break-words pr-4 text-[15px] leading-relaxed">
        <RichText text={idea.body} />
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">{formatDateTime(idea.updatedAt)}</span>
        <span onClick={(e) => e.stopPropagation()} className="opacity-100 md:opacity-0 md:transition-opacity md:group-hover:opacity-100">
          <RowMenu
            items={[
              idea.pinned
                ? { label: "Unpin", icon: PushPinSlash, onSelect: () => update.mutate({ pinned: false }) }
                : { label: "Pin", icon: PushPin, onSelect: () => update.mutate({ pinned: true }) },
              { label: "Delete", icon: Trash, danger: true, onSelect: () => remove.mutate(undefined) },
            ]}
          />
        </span>
      </div>
    </motion.article>
  );
}

function IdeaEditor({ idea, onClose }: { idea: Idea | null; onClose: () => void }) {
  const [body, setBody] = useState(idea?.body ?? "");
  const [color, setColor] = useState(idea?.color ?? "");
  const save = useIdeaMutation(() =>
    db.update(t).set({ body: body.trim(), tags: tagsOf(body), color: color || null }).where(eq(t.id, idea!.id)),
  );
  if (!idea) return null;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Idea</DialogTitle>
        </DialogHeader>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-48" autoFocus />
        <div className="grid gap-2">
          <span className="text-[13px] font-medium">Colour</span>
          <ColorPicker colors={["", ...PALETTE.slice(0, 9)].filter(Boolean)} value={color} onChange={(c) => setColor(c === color ? "" : c)} />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!body.trim()}
            loading={save.isPending}
            onClick={async () => {
              await save.mutateAsync(undefined);
              onClose();
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IdeasPage() {
  const { data, isLoading } = useIdeas();
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Idea | null>(null);
  const [surfaced, setSurfaced] = useState<string | null>(null);
  const add = useIdeaMutation((body: string) => db.insert(t).values({ body, tags: tagsOf(body) }));

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((i) => !q || i.body.toLowerCase().includes(q));
  }, [data, query]);
  const surfacedIdea = data?.find((i) => i.id === surfaced) ?? null;

  async function capture() {
    if (!draft.trim()) return;
    await add.mutateAsync(draft.trim());
    setDraft("");
  }

  function resurface() {
    if (!data?.length) return;
    const pool = data.filter((i) => i.id !== surfaced);
    const pick = (pool.length ? pool : data)[Math.floor(Math.random() * (pool.length || data.length))];
    setSurfaced(pick.id);
  }

  return (
    <Page hue={HUE}>
      <PageHeader
        title="Ideas"
        description="Scribble anything. No deadlines."
        icon={mod.icon}
        hue={HUE}
        actions={
          data && data.length > 1 ? (
            <Button variant="secondary" size="sm" onClick={resurface}>
              <Shuffle />
              Resurface
            </Button>
          ) : null
        }
      />

      <motion.div variants={rise} className="mt-8 rounded-2xl border border-border bg-surface shadow-soft transition-shadow focus-within:shadow-float">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void capture();
          }}
          placeholder="What's on your mind? Use #tags if you like."
          rows={draft.split("\n").length > 2 ? 5 : 2}
          className="block w-full resize-none bg-transparent px-4 pt-4 text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground/80"
        />
        <div className="flex items-center justify-between px-3 pb-3">
          <span className="hidden pl-1 text-[12px] text-muted-foreground sm:inline">Ctrl or ⌘ + Enter to save</span>
          <Button size="sm" className="ml-auto" disabled={!draft.trim()} loading={add.isPending} onClick={capture} style={{ background: HUE }}>
            Save idea
          </Button>
        </div>
      </motion.div>

      <AnimatePresence>
        {surfacedIdea ? (
          <motion.div
            key={surfacedIdea.id}
            initial={{ opacity: 0, y: -8, rotateX: 20 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.45, ease }}
            className="mt-6"
          >
            <p className="mb-2 text-[13px] font-semibold text-muted-foreground">From a while back</p>
            <IdeaCard idea={surfacedIdea} onOpen={setEditing} highlight />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {data && data.length > 6 ? (
        <motion.label variants={rise} className="mt-6 flex h-10 items-center gap-2.5 rounded-xl border border-border bg-surface px-3 shadow-soft">
          <MagnifyingGlass size={16} className="text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search ideas" className="flex-1 bg-transparent text-[14px] outline-none" />
        </motion.label>
      ) : null}

      <motion.div variants={rise} className="mt-6">
        {isLoading ? (
          <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
            <Skeleton className="mb-3 h-28" />
            <Skeleton className="mb-3 h-40" />
            <Skeleton className="mb-3 h-24" />
          </div>
        ) : !data?.length ? (
          <EmptyState icon={Lightbulb} hue={HUE} title="An empty scrapbook">
            Half-formed thoughts, links, names for things. Write them down before they float away.
          </EmptyState>
        ) : (
          <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
            <AnimatePresence initial={false}>
              {shown.map((idea) => (
                <IdeaCard key={idea.id} idea={idea} onOpen={setEditing} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      <IdeaEditor key={editing?.id ?? "none"} idea={editing} onClose={() => setEditing(null)} />
    </Page>
  );
}
