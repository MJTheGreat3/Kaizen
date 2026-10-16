import { useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowLeft, Camera, ImageBroken, LockKey, Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Segmented, Skeleton } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionTitle } from "@/components/ui/kit";
import type { Attachment, BodyMetric } from "@/core/db/schema";
import { usePrivate, usePrivateFiles } from "@/core/security/private";
import { Page } from "@/core/shell/PageHeader";
import { AppError } from "@/lib/ipc";
import { addDaysKey, formatLongDate, todayKey } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { modules, pathOf } from "@/modules/registry";
import { LineChart } from "./Charts";
import { useAddPhotos, useGym, usePhoto, useRemovePhoto, useUnit } from "./data";
import { MetricDialog } from "./Dialogs";
import { MEASUREMENTS, toUnit } from "./logic";

const HUE = modules.find((m) => m.id === "fitness")!.hue;

type Series = "weight" | "bodyFat" | (typeof MEASUREMENTS)[number]["key"];

function Photo({ photo, className, onOpen }: { photo: Attachment; className?: string; onOpen?: () => void }) {
  const { data, error, isLoading } = usePhoto(photo.id, true);
  return (
    <button type="button" onClick={onOpen} disabled={!data} className={cn("relative grid aspect-[3/4] place-items-center overflow-hidden rounded-xl bg-surface-muted", className)}>
      {data ? <img src={data} alt={`Progress photo, ${photo.ownerId.slice(3)}`} className="size-full object-cover" /> : null}
      {isLoading ? <span className="absolute inset-0 animate-pulse bg-surface-muted" /> : null}
      {error ? (
        <span className="grid justify-items-center gap-1 px-2 text-center text-[11px] text-muted-foreground">
          <ImageBroken size={20} />
          {String(error instanceof Error ? error.message : error)}
        </span>
      ) : null}
    </button>
  );
}

function PhotoViewer({ photo, onClose }: { photo: Attachment; onClose: () => void }) {
  const remove = useRemovePhoto();
  const { data } = usePhoto(photo.id, usePrivate((s) => s.open));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{formatLongDate(photo.ownerId.slice(3))}</DialogTitle>
        </DialogHeader>
        {data ? <img src={data} alt="Progress photo" className="max-h-[65vh] w-full rounded-xl object-contain" /> : <Skeleton className="aspect-[3/4] rounded-xl" />}
        <DialogFooter>
          <Button
            variant="danger-ghost"
            className="mr-auto"
            onClick={async () => {
              await remove.mutateAsync(photo.id);
              onClose();
            }}
          >
            <Trash />
            Delete
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Asks for the passphrase before progress photos are shown. */
function PhotosLocked({ count }: { count: number }) {
  const unlock = usePrivate((s) => s.unlock);
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(passphrase);
    } catch (err) {
      setError(err instanceof AppError && err.code === "wrong_secret" ? "That passphrase doesn't match." : err instanceof Error ? err.message : String(err));
      setPassphrase("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid justify-items-center gap-3 rounded-xl border border-dashed border-border px-4 py-7 text-center">
      <LockKey size={24} className="text-muted-foreground" />
      <p className="text-[14px] text-muted-foreground">{count === 1 ? "1 photo" : `${count} photos`}, locked. Enter your passphrase to see them.</p>
      <div className="flex w-full max-w-[340px] gap-2">
        <Input
          type="password"
          aria-label="Passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="current-password"
          placeholder="Passphrase"
          aria-invalid={!!error}
        />
        <Button type="submit" loading={busy} disabled={!passphrase}>
          Open
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Weight, body fat and measurements over time, and progress photos. */
export function BodyPage() {
  const { data, isLoading } = useGym();
  const unit = useUnit();
  const addPhotos = useAddPhotos();
  const photosOpen = usePrivateFiles();
  const [editing, setEditing] = useState<BodyMetric | "new" | null>(null);
  const [series, setSeries] = useState<Series>("weight");
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [allEntries, setAllEntries] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const today = todayKey();

  const metrics = useMemo(() => data?.metrics ?? [], [data]);
  const latest = (key: Series) => [...metrics].reverse().find((m) => m[key] != null);
  const at = (key: Series, before: string) => [...metrics].reverse().find((m) => m.date <= before && m[key] != null);
  const points = metrics.filter((m) => m[series] != null).map((m) => ({ at: new Date(`${m.date}T12:00:00`).getTime(), value: m[series]! }));
  const isWeight = series === "weight";
  const fmt = (v: number) => (isWeight ? `${toUnit(v, unit)}` : series === "bodyFat" ? `${Math.round(v * 10) / 10}%` : `${Math.round(v * 10) / 10}`);
  const lastWeight = latest("weight");
  const monthAgo = at("weight", addDaysKey(today, -30));
  const change = lastWeight && monthAgo && monthAgo.date !== lastWeight.date ? lastWeight.weight! - monthAgo.weight! : null;
  const photosByDay = useMemo(() => {
    const out = new Map<string, Attachment[]>();
    for (const p of data?.photos ?? []) out.set(p.ownerId, [...(out.get(p.ownerId) ?? []), p]);
    return [...out];
  }, [data]);
  const options: { value: Series; label: string }[] = [
    { value: "weight", label: "Weight" },
    ...(metrics.some((m) => m.bodyFat != null) ? [{ value: "bodyFat" as const, label: "Body fat" }] : []),
    ...MEASUREMENTS.filter((x) => metrics.some((m) => m[x.key] != null)).map((x) => ({ value: x.key, label: x.label })),
  ];

  return (
    <Page hue={HUE} className="max-w-[960px]">
      <motion.div variants={rise} className="flex items-center justify-between gap-2">
        <Link to={pathOf("fitness")} className="flex items-center gap-1.5 text-[14px] font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} />
          Gym
        </Link>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={addPhotos.isPending} onClick={() => file.current?.click()}>
            <Camera />
            Photos
          </Button>
          <Button size="sm" onClick={() => setEditing(latest("weight")?.date === today ? latest("weight")! : "new")}>
            <Plus />
            Log
          </Button>
        </div>
      </motion.div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          try {
            await addPhotos.mutateAsync({ date: today, files });
            toast.success(files.length === 1 ? "Photo saved" : `${files.length} photos saved`);
          } catch (err) {
            toast.error(`Could not save: ${String(err)}`);
          }
        }}
      />

      <motion.div variants={rise} className="mt-4">
        <h1 className="text-[26px] font-semibold tracking-tight">Body</h1>
        <p className="text-[14px] text-muted-foreground">Photos stay encrypted on the device that took them.</p>
      </motion.div>

      {isLoading || !data ? (
        <Skeleton className="mt-6 h-64 rounded-2xl" />
      ) : (
        <div className="mt-6 grid gap-4">
          <motion.div variants={rise} className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Weight", value: lastWeight ? `${toUnit(lastWeight.weight!, unit)} ${unit}` : "–", sub: lastWeight ? formatLongDate(lastWeight.date) : "Not logged" },
              { label: "30-day change", value: change === null ? "–" : `${change > 0 ? "+" : ""}${toUnit(change, unit)} ${unit}`, sub: "Against a month ago" },
              { label: "Body fat", value: latest("bodyFat") ? `${latest("bodyFat")!.bodyFat}%` : "–", sub: latest("bodyFat") ? formatLongDate(latest("bodyFat")!.date) : "Not logged" },
              { label: "Waist", value: latest("waist") ? `${latest("waist")!.waist} cm` : "–", sub: latest("waist") ? formatLongDate(latest("waist")!.date) : "Not logged" },
            ].map((t) => (
              <div key={t.label} className="rounded-2xl border border-border bg-surface p-4 shadow-soft">
                <p className="text-[12px] font-medium text-muted-foreground">{t.label}</p>
                <p className="mt-1 truncate text-[22px] font-semibold leading-none tracking-tight tabular-nums">{t.value}</p>
                <p className="mt-1 truncate text-[12px] text-muted-foreground">{t.sub}</p>
              </div>
            ))}
          </motion.div>

          <motion.section variants={rise} className="rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight">Trend</h2>
              {options.length > 1 ? (
                <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
                  <Segmented label="Measure" value={series} onChange={setSeries} options={options} />
                </div>
              ) : null}
            </div>
            <LineChart points={points} color={HUE} label="Body trend" format={fmt} />
            <p className="mt-1 text-right text-[12px] text-muted-foreground">{isWeight ? unit : series === "bodyFat" ? "%" : "cm"}</p>
          </motion.section>

          <div className="grid gap-4 md:grid-cols-2">
            <motion.section variants={rise} className="rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
              <SectionTitle>Entries</SectionTitle>
              {metrics.length ? (
                <ul className="-mx-1 grid gap-0.5">
                  {[...metrics]
                    .reverse()
                    .slice(0, allEntries ? undefined : 8)
                    .map((m) => {
                      const parts = [
                        m.weight != null ? `${toUnit(m.weight, unit)} ${unit}` : null,
                        m.bodyFat != null ? `${m.bodyFat}%` : null,
                        ...MEASUREMENTS.filter((x) => m[x.key] != null).map((x) => `${x.label.toLowerCase()} ${m[x.key]}`),
                      ].filter(Boolean);
                      const photos = photosByDay.find(([id]) => id === m.id)?.[1].length ?? 0;
                      return (
                        <li key={m.id}>
                          <button type="button" onClick={() => setEditing(m)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-muted">
                            <span className="grid min-w-0 flex-1">
                              <span className="text-[14px] font-medium">{formatLongDate(m.date)}</span>
                              <span className="truncate text-[12px] text-muted-foreground">{parts.join(" · ") || m.notes || "Photos only"}</span>
                            </span>
                            {photos ? (
                              <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                                <Camera size={14} />
                                {photos}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  {!allEntries && metrics.length > 8 ? (
                    <button type="button" onClick={() => setAllEntries(true)} className="mt-2 justify-self-center text-[13px] font-medium text-muted-foreground hover:text-foreground">
                      Show all {metrics.length}
                    </button>
                  ) : null}
                </ul>
              ) : (
                <p className="py-6 text-center text-[14px] text-muted-foreground">Log your weight to start the trend.</p>
              )}
            </motion.section>

            <motion.section variants={rise} className="rounded-2xl border border-border bg-surface p-4 shadow-soft md:p-5">
              <SectionTitle>Progress photos</SectionTitle>
              {photosByDay.length && !photosOpen ? (
                <PhotosLocked count={data?.photos.length ?? 0} />
              ) : photosByDay.length ? (
                <div className="grid gap-4">
                  {photosByDay.slice(0, 6).map(([day, list]) => (
                    <div key={day}>
                      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">{formatLongDate(day.slice(3))}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {list.map((p) => (
                          <Photo key={p.id} photo={p} onOpen={() => setViewing(p)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <button type="button" onClick={() => file.current?.click()} className="grid w-full justify-items-center gap-2 rounded-xl border border-dashed border-border py-10 text-[14px] text-muted-foreground hover:bg-surface-muted">
                  <Camera size={22} />
                  Add today's photos
                </button>
              )}
            </motion.section>
          </div>
        </div>
      )}

      {editing ? <MetricDialog metric={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
      {viewing && photosOpen ? <PhotoViewer photo={viewing} onClose={() => setViewing(null)} /> : null}
    </Page>
  );
}
