import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Desktop,
  DeviceMobile,
  Faders,
  Heart,
  Pause,
  Play,
  Repeat,
  RepeatOnce,
  Shuffle,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  SpeakerSimpleNone,
  SpeakerHifi,
  Waveform,
} from "@phosphor-icons/react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePref } from "@/core/db/prefs";
import { openUrl } from "@/lib/native";
import { cn } from "@/lib/utils";
import { useAudioFxState, useControl, useDevices, useSaved, useToggleSaved, playWithWake } from "./data";
import { Disc, type VisualSource } from "./Disc";
import { EqualizerDialog } from "./Equalizer";
import { Lyrics } from "./Lyrics";
import { clock, type Palette } from "./logic";
import { audioFx, audioFxAvailable } from "./native";
import { imageFor, nextRepeat, positionNow, spotify, type Device, type Playback } from "./spotify";

const SWIPE_PX = 70;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function useViewportHeight() {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return h;
}

/** Re-renders every `ms` while `on`. */
function useTick(ms: number, on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms, on]);
}

function RoundButton({
  label,
  onClick,
  active,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "grid size-11 place-items-center rounded-full transition-[opacity,transform,background-color] hover:bg-current/10 active:scale-90",
        active === false && "opacity-60",
        className,
      )}
    >
      {children}
    </button>
  );
}

function DeviceGlyph({ device, size }: { device: Device | null; size: number }) {
  if (device?.type === "Smartphone") return <DeviceMobile size={size} />;
  if (device?.type === "Computer") return <Desktop size={size} />;
  return <SpeakerHifi size={size} />;
}

function DevicesDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: Device | null }) {
  const { data, isLoading } = useDevices(open);
  const control = useControl();
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Play on</DialogTitle>
        </DialogHeader>
        <ul className="grid gap-1">
          {(data ?? []).map((d) => {
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => {
                    control.mutate({ run: () => spotify.transfer(d.id, true) });
                    onClose();
                  }}
                  className={cn(
                    "hover:bg-surface-muted flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                    d.id === current?.id && "bg-surface-muted",
                  )}
                >
                  <DeviceGlyph device={d} size={20} />
                  <span className="flex-1 text-[15px] font-medium">{d.name}</span>
                  {d.isActive ? <span className="text-muted-foreground text-[12px]">Playing here</span> : null}
                </button>
              </li>
            );
          })}
          {!isLoading && !data?.length ? (
            <li className="text-muted-foreground px-1 py-4 text-[14px]">
              No Spotify app is open. Open Spotify on this phone or the laptop and it will show here.
            </li>
          ) : null}
        </ul>
        <button
          type="button"
          onClick={() => void openUrl("spotify:")}
          className="justify-self-start text-[14px] font-medium underline underline-offset-4"
        >
          Open Spotify
        </button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The player: the disc, what is playing, controls and lyrics, in the
 * cover's colours. Swiping across it (not on the disc) skips forward or
 * back.
 */
export function Player({ playback, palette }: { playback: Playback; palette: Palette }) {
  const item = playback.item;
  const control = useControl();
  const saved = useSaved(item?.kind === "track" ? item.id : undefined);
  const toggleSaved = useToggleSaved();
  const [box, width] = useWidth();
  const [direction, setDirection] = useState(1);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [eqOpen, setEqOpen] = useState(false);
  const [visualPref, setVisualPref] = usePref("music.visualizer");
  const fx = useAudioFxState(true);
  const [audioFailed, setAudioFailed] = useState(false);
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  useTick(500, playback.isPlaying);

  const position = useCallback(() => positionNow(playback), [playback]);
  const wide = width >= 760;
  const tall = useViewportHeight();
  // On the phone the disc leaves room for the title, a few lines of lyrics and the controls.
  const discSize = Math.round(Math.min(wide ? 360 : 300, (width - 8) / 1.34, wide ? Infinity : (tall - 590) / 1.34));
  const visual: VisualSource = !visualPref
    ? "off"
    : audioFxAvailable() && fx.data?.record && !audioFailed
      ? "audio"
      : "animated";
  const onVisualFail = useCallback(() => setAudioFailed(true), []);

  const seek = (ms: number) =>
    control.mutate({ run: () => spotify.seek(ms), optimistic: (p) => ({ ...p, progressMs: ms }) });
  const toggle = () =>
    control.mutate({
      run: () => (playback.isPlaying ? spotify.pause() : playWithWake()),
      optimistic: (p) => ({ ...p, isPlaying: !p.isPlaying }),
    });
  const skip = (dir: 1 | -1) => {
    setDirection(dir);
    control.mutate({ run: () => (dir > 0 ? spotify.next() : spotify.previous()) });
  };

  const now = position();
  const duration = item?.durationMs ?? 0;
  const device = playback.device;
  const [volume, setVolume] = useState<number | null>(null);
  const heartButton =
    saved.data !== null && saved.data !== undefined && item ? (
      <RoundButton
        label={saved.data ? "Remove from Liked Songs" : "Add to Liked Songs"}
        onClick={() => toggleSaved.mutate({ id: item.id, on: !saved.data })}
      >
        <Heart
          size={22}
          weight={saved.data ? "fill" : "regular"}
          style={{ color: saved.data ? palette.accent : undefined }}
        />
      </RoundButton>
    ) : (
      <span className="size-11" />
    );
  const topRow = (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setDevicesOpen(true)}
        className="flex min-w-0 items-center gap-2 rounded-full bg-current/10 px-3 py-1.5 text-[13px] font-medium"
      >
        <DeviceGlyph device={device} size={15} />
        <span className="truncate">{device?.name ?? "Choose a device"}</span>
      </button>
      {/* Pulled right so the icons line up with the edge, not the buttons' padding. */}
      <div className="-mr-2.5 ml-auto flex shrink-0 items-center">
        <RoundButton
          label={visualPref ? "Hide the visualiser" : "Show the visualiser"}
          active={visualPref}
          onClick={() => void setVisualPref(!visualPref)}
        >
          <Waveform size={20} />
        </RoundButton>
        <RoundButton label="Equaliser" onClick={() => setEqOpen(true)}>
          <Faders size={20} />
        </RoundButton>
        {wide || saved.data === null || saved.data === undefined ? null : heartButton}
      </div>
    </div>
  );

  return (
    <div
      ref={box}
      className="touch-pan-y"
      onPointerDown={(e) => {
        if ((e.target as Element).closest("button:not([data-line]), input, a, [data-no-swipe]")) return;
        swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s || s.id !== e.pointerId) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) skip(dx < 0 ? 1 : -1);
      }}
    >
      {wide ? null : <div className="mb-1">{topRow}</div>}
      <div
        className={cn(
          "grid items-center",
          wide ? "grid-cols-[auto_minmax(0,1fr)] gap-10" : "justify-items-center gap-3",
        )}
      >
        <div className="grid justify-items-center gap-2">
          <Disc
            size={Math.max(180, discSize)}
            playing={playback.isPlaying}
            art={imageFor(item?.images, 300)}
            durationMs={duration}
            position={position}
            palette={palette}
            visual={visual}
            onVisualFail={onVisualFail}
            onSeek={seek}
            onToggle={toggle}
          />
          {wide ? (
            <p className="text-[12px] opacity-60">Turn the disc to move through the song · tap to pause</p>
          ) : null}
          {audioFxAvailable() && visualPref && fx.data && !fx.data.record ? (
            <button
              type="button"
              onClick={async () => {
                await audioFx.requestRecord().catch(() => false);
                setAudioFailed(false);
                void fx.refetch();
              }}
              className="rounded-full bg-current/10 px-3 py-1.5 text-[12px] font-medium"
            >
              Let the visualiser follow the music
            </button>
          ) : null}
        </div>

        <div className={cn("grid min-w-0", wide ? "content-start gap-5 self-stretch" : "w-full gap-3")}>
          {wide ? topRow : null}

          <div className={cn("relative overflow-hidden", wide ? "min-h-[4.5rem]" : "min-h-[3.4rem]")}>
            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
              <motion.div
                key={item?.id ?? "none"}
                custom={direction}
                initial={{ x: direction * 60, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: direction * -60, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className={cn("grid min-w-0 gap-0.5", !wide && "text-center")}
              >
                <h2 className="truncate text-[24px] leading-tight font-bold tracking-tight md:text-[30px]">
                  {item?.name ?? "Nothing playing"}
                </h2>
                <p className="truncate text-[15px] font-medium opacity-80">
                  {item?.artists.map((a) => a.name).join(", ")}
                </p>
                {wide ? <p className="truncate text-[13px] opacity-60">{item?.album}</p> : null}
              </motion.div>
            </AnimatePresence>
          </div>

          {!wide ? (
            <Lyrics item={item} position={position} onSeek={seek} className="-my-2 h-[max(7.5rem,17vh)] text-center" />
          ) : null}

          <div className="grid gap-2">
            <div className="flex justify-between text-[12px] font-medium tabular-nums opacity-70">
              <span>{clock(now)}</span>
              <span>-{clock(Math.max(0, duration - now))}</span>
            </div>
            <div className="flex items-center justify-between">
              <RoundButton
                label="Shuffle"
                active={playback.shuffle}
                onClick={() =>
                  control.mutate({
                    run: () => spotify.shuffle(!playback.shuffle),
                    optimistic: (p) => ({ ...p, shuffle: !p.shuffle }),
                  })
                }
              >
                <Shuffle size={20} weight={playback.shuffle ? "bold" : "regular"} />
              </RoundButton>
              <RoundButton label="Previous" onClick={() => skip(-1)}>
                <SkipBack size={26} weight="fill" />
              </RoundButton>
              <button
                type="button"
                aria-label={playback.isPlaying ? "Pause" : "Play"}
                onClick={toggle}
                className="grid size-16 place-items-center rounded-full shadow-lg transition-transform active:scale-90"
                style={{ background: palette.text, color: palette.bg }}
              >
                {playback.isPlaying ? (
                  <Pause size={28} weight="fill" />
                ) : (
                  <Play size={28} weight="fill" className="translate-x-0.5" />
                )}
              </button>
              <RoundButton label="Next" onClick={() => skip(1)}>
                <SkipForward size={26} weight="fill" />
              </RoundButton>
              <RoundButton
                label={`Repeat: ${playback.repeat}`}
                active={playback.repeat !== "off"}
                onClick={() =>
                  control.mutate({
                    run: () => spotify.repeat(nextRepeat[playback.repeat]),
                    optimistic: (p) => ({ ...p, repeat: nextRepeat[p.repeat] }),
                  })
                }
              >
                {playback.repeat === "track" ? (
                  <RepeatOnce size={20} weight="bold" />
                ) : (
                  <Repeat size={20} weight={playback.repeat === "context" ? "bold" : "regular"} />
                )}
              </RoundButton>
            </div>
            <div className="flex items-center gap-3">
              {wide ? heartButton : null}
              {device?.supportsVolume ? (
                <label className="flex flex-1 items-center gap-2" data-no-swipe>
                  <SpeakerSimpleNone size={16} className="opacity-70" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume ?? device.volume ?? 50}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    onPointerUp={() => volume !== null && control.mutate({ run: () => spotify.volume(volume) })}
                    onKeyUp={() => volume !== null && control.mutate({ run: () => spotify.volume(volume) })}
                    className="flex-1"
                    style={{ accentColor: palette.accent }}
                    aria-label="Volume"
                  />
                  <SpeakerHigh size={16} className="opacity-70" />
                </label>
              ) : (
                <span className="flex-1" />
              )}
            </div>
          </div>

          {wide ? <Lyrics item={item} position={position} onSeek={seek} className="h-[300px]" /> : null}
        </div>
      </div>

      <DevicesDialog open={devicesOpen} onClose={() => setDevicesOpen(false)} current={device} />
      <EqualizerDialog open={eqOpen} onClose={() => setEqOpen(false)} />
    </div>
  );
}
