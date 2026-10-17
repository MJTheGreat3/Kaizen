import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CaretDown, Copy, GoogleDriveLogo, SpotifyLogo } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ipc, type KeysStatus } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { Section } from "./layout";

const SPOTIFY_REDIRECT = "http://127.0.0.1:43821/callback";

function CopyLine({ text }: { text: string }) {
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}
      className="border-border bg-surface-muted mt-1 flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-left font-mono text-[12px]"
    >
      <span className="truncate">{text}</span>
      <Copy size={14} className="shrink-0" />
    </button>
  );
}

function Help({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[13px] font-medium">
        <CaretDown size={12} className={cn("transition-transform", !open && "-rotate-90")} />
        {title}
      </button>
      {open ? <ol className="text-muted-foreground mt-2 grid list-decimal gap-1.5 pl-5 text-[13px] leading-relaxed">{children}</ol> : null}
    </div>
  );
}

/**
 * Your own OAuth clients for Google Drive sync and Spotify. Published builds
 * carry none, so each person makes their own (free) and enters it here, on
 * each device.
 */
export function ConnectionsSection() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ["keys"], queryFn: ipc.keysStatus });
  return (
    <Section
      title="Connections"
      description="Google Drive sync and Spotify need your own free developer keys. They stay on this device, encrypted; enter them on each device you use."
    >
      {status.data ? (
        <KeysForm
          key={`${status.data.googleId}|${status.data.spotifyId}|${status.data.googleSecretSet}`}
          status={status.data}
          onSaved={(next) => {
            client.setQueryData(["keys"], next);
            void client.invalidateQueries({ queryKey: ["sync-status"] });
            void client.invalidateQueries({ queryKey: ["music"] });
          }}
        />
      ) : null}
    </Section>
  );
}

function KeysForm({ status, onSaved }: { status: KeysStatus; onSaved: (s: KeysStatus) => void }) {
  const [googleId, setGoogleId] = useState(status.googleId);
  const [googleSecret, setGoogleSecret] = useState("");
  const [spotifyId, setSpotifyId] = useState(status.spotifyId);
  const save = useMutation({
    mutationFn: () => ipc.keysSave({ googleId, googleSecret: googleSecret || (googleId.trim() ? undefined : ""), spotifyId }),
    onSuccess: (next) => {
      onSaved(next);
      setGoogleSecret("");
      toast.success("Saved", { description: "Connect from Settings → Sync or the Music page." });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });
  const googleIncomplete = !!googleId.trim() && !googleSecret && !status.googleSecretSet;
  const changed = googleId !== status.googleId || spotifyId !== status.spotifyId || !!googleSecret;

  return (
    <div className="grid gap-5 px-4 py-4 md:px-5">
      <div className="grid gap-3">
        <div className="flex items-center gap-2 text-[15px] font-medium">
          <GoogleDriveLogo size={18} />
          Google Drive
          {status.googleBuiltIn && !status.googleId ? <span className="text-muted-foreground text-[12px] font-normal">· built into this build</span> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Client ID" htmlFor="keys-google-id">
            <Input id="keys-google-id" value={googleId} onChange={(e) => setGoogleId(e.target.value)} placeholder="…apps.googleusercontent.com" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Client secret" htmlFor="keys-google-secret" error={googleIncomplete ? "Needed with the client ID" : null}>
            <Input
              id="keys-google-secret"
              type="password"
              value={googleSecret}
              onChange={(e) => setGoogleSecret(e.target.value)}
              placeholder={status.googleSecretSet ? "Saved (type to replace)" : "GOCSPX-…"}
              autoComplete="off"
            />
          </Field>
        </div>
        <Help title="How to get these">
          <li>Open console.cloud.google.com, create a project and enable the <b>Google Drive API</b>.</li>
          <li>
            Under <b>Google Auth Platform</b>, set up the consent screen (External), add the scopes <code>…/auth/drive.appdata</code>, <code>openid</code> and{" "}
            <code>…/auth/userinfo.email</code>, then <b>Publish app</b> (in Testing, Google signs you out every week).
          </li>
          <li>
            Under <b>Clients</b>, create a client of type <b>Desktop app</b> (it works on the phone too). Copy its client ID and secret here.
          </li>
        </Help>
      </div>

      <div className="grid gap-3">
        <div className="flex items-center gap-2 text-[15px] font-medium">
          <SpotifyLogo size={18} />
          Spotify
          {status.spotifyBuiltIn && !status.spotifyId ? <span className="text-muted-foreground text-[12px] font-normal">· built into this build</span> : null}
        </div>
        <Field label="Client ID" htmlFor="keys-spotify-id">
          <Input id="keys-spotify-id" value={spotifyId} onChange={(e) => setSpotifyId(e.target.value)} autoComplete="off" spellCheck={false} />
        </Field>
        <Help title="How to get this">
          <li>Open developer.spotify.com/dashboard with a Premium account and choose <b>Create app</b>.</li>
          <li>
            Tick <b>Web API</b> and add this exact redirect URI:
            <CopyLine text={SPOTIFY_REDIRECT} />
          </li>
          <li>Save, then copy the app's <b>Client ID</b> here.</li>
        </Help>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={!changed || googleIncomplete} loading={save.isPending}>
          Save
        </Button>
      </div>
    </div>
  );
}
