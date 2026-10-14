import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePref } from "@/core/db/prefs";
import { cn } from "@/lib/utils";
import { eqGains, presetName, useAudioFxState } from "./data";
import { EQ_PRESETS, hz } from "./logic";
import { audioFx, audioFxAvailable } from "./native";

/**
 * Equaliser presets and bands. On the phone they apply to Spotify's audio
 * through Android's equaliser; on the laptop there is no way to reach
 * Spotify's audio, so this points to Spotify's own equaliser.
 */
export function EqualizerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [eq, setEq] = usePref("music.eq");
  const fx = useAudioFxState(open);
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bands = fx.data?.eqBands ?? [];
  const min = fx.data?.eqMin ?? -12;
  const max = fx.data?.eqMax ?? 12;
  const gains = eqGains(eq, bands, min, max);

  useEffect(() => () => clearTimeout(timer.current), []);

  function apply(next: typeof eq) {
    void setEq(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      audioFx
        .eqSet(next.on, eqGains(next, bands, min, max), presetName(next.preset))
        .then(() => setError(null))
        .catch((e) => setError(String(e)))
        .finally(() => void client.invalidateQueries({ queryKey: ["music", "audiofx"] }));
    }, 120);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Equaliser</DialogTitle>
          <DialogDescription>
            {audioFxAvailable()
              ? "Shapes Spotify's sound on this phone. It stays on in the background while a quiet notification shows."
              : "Kaizen cannot reach Spotify's audio on the laptop. Use Spotify's own equaliser: Settings, Playback, Equaliser."}
          </DialogDescription>
        </DialogHeader>

        {audioFxAvailable() ? (
          <div className="grid gap-4">
            <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2.5">
              <span className="text-[14px] font-medium">On</span>
              <Switch checked={eq.on} onCheckedChange={(on) => apply({ ...eq, on })} />
            </label>

            <div className={cn("grid gap-4 transition-opacity", !eq.on && "pointer-events-none opacity-45")}>
              <div className="flex flex-wrap gap-1.5">
                {EQ_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => apply({ ...eq, preset: p.id })}
                    className={cn(
                      "h-8 rounded-full border px-3 text-[13px] font-medium transition-colors",
                      eq.preset === p.id ? "border-transparent bg-foreground text-background" : "border-border hover:bg-surface-muted",
                    )}
                  >
                    {p.name}
                  </button>
                ))}
                {eq.preset === "custom" ? (
                  <span className="flex h-8 items-center rounded-full bg-foreground px-3 text-[13px] font-medium text-background">Custom</span>
                ) : null}
              </div>

              {bands.length ? (
                <div className="grid gap-2">
                  {bands.map((f, i) => (
                    <label key={f} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-3 text-[13px]">
                      <span className="text-muted-foreground tabular-nums">{hz(f)}</span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={0.5}
                        value={gains[i] ?? 0}
                        onChange={(e) => {
                          const custom = [...gains];
                          custom[i] = Number(e.target.value);
                          apply({ ...eq, preset: "custom", custom });
                        }}
                        className="accent-[var(--accent)]"
                        aria-label={`${hz(f)} gain`}
                      />
                      <span className="text-right tabular-nums">{(gains[i] ?? 0) > 0 ? "+" : ""}{gains[i] ?? 0} dB</span>
                    </label>
                  ))}
                </div>
              ) : fx.isLoading ? null : (
                <p className="text-[13px] text-muted-foreground">This phone did not report an equaliser{fx.data?.eqError ? `: ${fx.data.eqError}` : "."}</p>
              )}
            </div>

            {error ? <p className="text-[13px] text-danger">{error}</p> : null}
            {fx.data && !fx.data.spotifySession ? (
              <p className="text-[12px] text-muted-foreground">
                Spotify has not announced its audio yet, so this applies to everything the phone plays. Play a song in Spotify and it will move onto Spotify's audio.
              </p>
            ) : null}
          </div>
        ) : null}

        <p className="text-[12px] text-muted-foreground">
          Sound quality is chosen in Spotify itself: Settings, Audio quality, then Very high or Lossless for streaming and downloads.
        </p>
      </DialogContent>
    </Dialog>
  );
}
