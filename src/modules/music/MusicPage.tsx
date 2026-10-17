import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Copy, Heart, MusicNotes, SignOut, SpotifyLogo } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { RowMenu } from "@/components/ui/kit";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { openUrl } from "@/lib/native";
import { rise } from "@/lib/motion";
import { modules } from "@/modules/registry";
import { useConnect, useDisconnect, useLiked, useMusicStatus, usePalette, usePlay, usePlayback } from "./data";
import { Library, Tabs } from "./Library";
import { DEFAULT_PALETTE, type Palette } from "./logic";
import { Player } from "./Player";
import { Stats } from "./Stats";

const mod = modules.find((m) => m.id === "music")!;

function Steps({ redirectUri, configured }: { redirectUri: string; configured: boolean }) {
  const copy = () => void navigator.clipboard.writeText(redirectUri).then(() => toast.success("Copied"));
  return (
    <ol className="grid gap-3 text-[14px] leading-relaxed">
      <li>
        <b>1.</b> Open the Spotify developer dashboard (developer.spotify.com/dashboard), sign in with your Premium account and choose <b>Create app</b>.
      </li>
      <li>
        <b>2.</b> Name it Kaizen, tick <b>Web API</b>, and add this exact redirect URI:
        <button type="button" onClick={copy} className="mt-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface-muted px-3 py-2 font-mono text-[13px]">
          {redirectUri}
          <Copy size={15} />
        </button>
      </li>
      <li>
        <b>3.</b> Save, then copy the app's <b>Client ID</b> into Kaizen under{" "}
        <Link to="/settings" className="font-medium underline">
          Settings → Connections
        </Link>{" "}
        on each device{configured ? " (done here)." : "."}
      </li>
      <li>
        <b>4.</b> Connect below on each device. Audio plays in the Spotify app; Kaizen is its remote, with lyrics, the disc and stats.
      </li>
      <li>
        <b>5.</b> For the best sound, in Spotify go to Settings, Audio quality, and pick <b>Very high</b> (or <b>Lossless</b>) for Wi-Fi, mobile data and downloads.
      </li>
    </ol>
  );
}

function Setup({ configured, redirectUri }: { configured: boolean; redirectUri: string }) {
  const connect = useConnect();
  return (
    <Page hue={mod.hue} className="max-w-[720px]">
      <PageHeader title="Music" description="Your Spotify, on a spinning disc, with lyrics and listening stats." icon={mod.icon} hue={mod.hue} />
      <motion.section variants={rise} className="mt-8 grid gap-5 rounded-2xl border border-border bg-surface p-5 shadow-soft md:p-6">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-[#1ed760]/15 text-[#1ed760]">
            <SpotifyLogo size={26} weight="fill" />
          </span>
          <div>
            <h2 className="text-[17px] font-semibold">{configured ? "Connect Spotify" : "Set up Spotify"}</h2>
            <p className="text-[13px] text-muted-foreground">Needs Spotify Premium. Takes about five minutes, once.</p>
          </div>
        </div>
        <Steps redirectUri={redirectUri} configured={configured} />
        {configured ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => connect.mutate()} loading={connect.isPending}>
              <SpotifyLogo weight="fill" />
              Connect Spotify
            </Button>
            {connect.isPending ? <span className="text-[13px] text-muted-foreground">Finish signing in in the browser, then come back.</span> : null}
          </div>
        ) : null}
      </motion.section>
    </Page>
  );
}

function Idle() {
  const play = usePlay();
  const liked = useLiked(true);
  return (
    <div className="grid justify-items-center gap-4 py-10 text-center">
      <span className="grid size-24 place-items-center rounded-full bg-current/10">
        <MusicNotes size={40} />
      </span>
      <div>
        <h2 className="text-[24px] font-bold">Nothing playing</h2>
        <p className="max-w-[44ch] text-[14px] opacity-70">Open Spotify on this phone or the laptop, or start something here and it plays on the Spotify app that is open.</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => liked.data?.items.length && play.mutate({ uris: liked.data.items.map((t) => t.uri) })}
          className="flex h-11 items-center gap-2 rounded-full bg-current/15 px-5 text-[14px] font-semibold"
        >
          <Heart size={17} weight="fill" />
          Play Liked Songs
        </button>
        <button type="button" onClick={() => void openUrl("spotify:")} className="flex h-11 items-center gap-2 rounded-full bg-current/[0.07] px-5 text-[14px] font-semibold">
          <SpotifyLogo size={17} weight="fill" />
          Open Spotify
        </button>
      </div>
    </div>
  );
}

/** The page painted in the cover's colours; they fade from song to song. */
function Backdrop({ palette }: { palette: Palette }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 md:left-[252px]">
      <AnimatePresence initial={false}>
        <motion.div
          key={`${palette.bg}${palette.accent}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9 }}
          className="absolute inset-0"
          style={{
            background: `radial-gradient(90% 60% at 20% 0%, color-mix(in srgb, ${palette.accent} 28%, transparent), transparent 70%), linear-gradient(180deg, ${palette.bg} 0%, ${palette.bg2} 100%)`,
          }}
        />
      </AnimatePresence>
    </div>
  );
}

function Connected({ name }: { name: string | null }) {
  const { data: playback, isLoading, isError, error } = usePlayback(1000);
  const disconnect = useDisconnect();
  const live = usePalette(playback?.item?.images);
  const palette = playback?.item ? live : DEFAULT_PALETTE;
  const [tab, setTab] = useState<"library" | "stats">("library");

  return (
    <div className="relative min-h-[100dvh]" style={{ color: palette.text, colorScheme: palette.dark ? "dark" : "light" }}>
      <Backdrop palette={palette} />
      <div className="relative mx-auto w-full max-w-[1100px] px-4 py-5 md:px-10 md:py-8">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 text-[14px] font-semibold opacity-80">
            <SpotifyLogo size={18} weight="fill" />
            {name ?? "Spotify"}
          </span>
          <RowMenu
            label="Music options"
            items={[
              { label: "Open Spotify", icon: SpotifyLogo, onSelect: () => void openUrl("spotify:") },
              { label: "Disconnect", icon: SignOut, danger: true, onSelect: () => disconnect.mutate() },
            ]}
          />
        </div>

        {isLoading ? (
          <Skeleton className="mx-auto mt-6 aspect-square w-72 rounded-full" />
        ) : isError ? (
          <p className="py-10 text-center opacity-80">{String(error instanceof Error ? error.message : error)}</p>
        ) : playback?.item ? (
          <Player playback={playback} palette={palette} />
        ) : (
          <Idle />
        )}

        <div className="mt-10 grid gap-5">
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: "library", label: "Library" },
              { value: "stats", label: "Stats" },
            ]}
          />
          {tab === "library" ? <Library /> : <Stats palette={palette} />}
        </div>
      </div>
    </div>
  );
}

export function MusicPage() {
  const { data, isLoading } = useMusicStatus();
  if (isLoading || !data)
    return (
      <Page hue={mod.hue}>
        <Skeleton className="h-64 rounded-2xl" />
      </Page>
    );
  if (!data.configured || !data.connected) return <Setup configured={data.configured} redirectUri={data.redirectUri} />;
  return <Connected name={data.name} />;
}
