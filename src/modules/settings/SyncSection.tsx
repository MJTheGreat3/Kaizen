import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { encode } from "uqr";
import {
  ArrowsClockwise,
  Camera,
  Copy,
  DeviceMobile,
  FolderOpen,
  GoogleDriveLogo,
  Laptop,
  LinkBreak,
  QrCode,
  SignOut,
  WarningCircle,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Skeleton, Switch } from "@/components/ui/controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/kit";
import { usePref } from "@/core/db/prefs";
import { isMobile, useSession } from "@/core/security/session";
import { syncNow, useSyncState } from "@/core/sync/autosync";
import { ipc, type SyncLogEntry, type SyncStatus } from "@/lib/ipc";
import { pickFolder, scanQr } from "@/lib/native";
import { formatDateTime } from "@/lib/utils";
import { Row, Section } from "./layout";

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function ago(ms: number | null) {
  if (!ms) return "never";
  return Date.now() - ms < 45_000 ? "just now" : `${formatDistanceToNowStrict(ms)} ago`;
}

/** QR code drawn as one SVG path, in the current text colour. */
function QrImage({ text, className }: { text: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const qr = encode(text, { border: 2, ecc: "M" });
    let d = "";
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { path: d, size: qr.size };
  }, [text]);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={className} shapeRendering="crispEdges" role="img" aria-label="Pairing QR code">
      <rect width={size} height={size} fill="white" />
      <path d={path} fill="black" />
    </svg>
  );
}

function PairCodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const code = useQuery({
    queryKey: ["sync-pair-code"],
    queryFn: async () => {
      const c = await ipc.syncPairCode();
      client.invalidateQueries({ queryKey: ["sync-status"] });
      return c;
    },
    enabled: open,
    staleTime: Infinity,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pair another device</DialogTitle>
          <DialogDescription>
            On your phone, open Settings → Sync → Join, and scan this code. Anyone with it can read your synced data, so
            only show it to your own devices.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 justify-items-center gap-4 py-2">
          {code.data ? (
            <>
              <div className="rounded-2xl bg-white p-3 shadow-soft">
                <QrImage text={code.data} className="size-56" />
              </div>
              <button
                type="button"
                className="flex w-full min-w-0 items-center justify-center gap-2 rounded-lg bg-surface-muted px-3 py-2 font-mono text-[12px] text-muted-foreground hover:text-foreground"
                onClick={async () => {
                  await navigator.clipboard.writeText(code.data);
                  toast.success("Code copied");
                }}
              >
                <span className="min-w-0 truncate">{code.data}</span>
                <Copy className="size-4 shrink-0" />
              </button>
            </>
          ) : (
            <Skeleton className="size-62 rounded-2xl" />
          )}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JoinDialog({ open, onOpenChange, mobile }: { open: boolean; onOpenChange: (open: boolean) => void; mobile: boolean }) {
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const join = useMutation({
    mutationFn: async (value: string) => {
      await ipc.syncJoin(value);
      await client.invalidateQueries({ queryKey: ["sync-status"] });
    },
    onSuccess: () => {
      toast.success("Paired. Connect Google Drive on this device to start syncing.");
      setCode("");
      onOpenChange(false);
      syncNow().catch(() => {});
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Join a device</DialogTitle>
          <DialogDescription>
            On the other device, open Settings → Sync → Show pairing code.
            {mobile ? " Then scan it here." : " Then paste the code below."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {mobile ? (
            <Button
              size="lg"
              onClick={async () => {
                const scanned = await scanQr();
                if (scanned) join.mutate(scanned);
              }}
              loading={join.isPending}
            >
              <Camera />
              Scan pairing code
            </Button>
          ) : null}
          <Field label={mobile ? "Or type the code" : "Pairing code"} htmlFor="pair-code">
            <Input
              id="pair-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="KZ1-…"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!code.trim()} loading={join.isPending && !!code} onClick={() => join.mutate(code)}>
            Join
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PeerIcon({ platform }: { platform: string }) {
  const Icon = platform === "android" || platform === "ios" ? DeviceMobile : Laptop;
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-muted text-muted-foreground">
      <Icon className="size-5" />
    </span>
  );
}

function LogLine({ entry }: { entry: SyncLogEntry }) {
  const via = { drive: "Google Drive", folder: "Folder", lan: "Direct" }[entry.transport] ?? entry.transport;
  return (
    <li className="flex items-start justify-between gap-4 py-2 text-[13px]">
      <span className="grid min-w-0">
        <span className="font-medium">{formatDateTime(entry.at)}</span>
        <span className={entry.error ? "break-words text-danger" : "text-muted-foreground"}>
          {entry.error ?? (entry.sent || entry.received ? `Sent ${entry.sent} · received ${entry.received}` : "Up to date")}
        </span>
      </span>
      <span className="shrink-0 text-muted-foreground">{via}</span>
    </li>
  );
}

function DriveRow({ status, mobile }: { status: SyncStatus; mobile: boolean }) {
  const client = useQueryClient();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const connect = useMutation({
    mutationFn: ipc.syncDriveConnect,
    onSuccess: (email) => {
      toast.success(email ? `Connected ${email}` : "Google Drive connected");
      client.invalidateQueries({ queryKey: ["sync-status"] });
      syncNow()
        .then(() => client.invalidateQueries({ queryKey: ["sync-status"] }))
        .catch((e) => toast.error(errorText(e)));
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const disconnect = useMutation({
    mutationFn: ipc.syncDriveDisconnect,
    onSuccess: () => client.invalidateQueries({ queryKey: ["sync-status"] }),
  });

  if (!status.driveAvailable) {
    return (
      <Row
        label="Google Drive"
        description="Not set up in this build. Add the Google OAuth client (see README → Sync) and rebuild."
      />
    );
  }
  if (status.driveAccount === null) {
    return (
      <Row
        label="Google Drive"
        description={
          connect.isPending
            ? `Finish signing in in the browser${mobile ? ", then come back to Kaizen" : ""}.`
            : "Syncs on any network, through a hidden app folder only Kaizen can see. Everything is encrypted first."
        }
      >
        <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>
          <GoogleDriveLogo />
          Connect
        </Button>
      </Row>
    );
  }
  return (
    <>
      <Row label="Google Drive" description={status.driveAccount ? `Connected as ${status.driveAccount}` : "Connected"}>
        <Button variant="ghost" size="sm" onClick={() => setConfirmDisconnect(true)}>
          <SignOut />
          Disconnect
        </Button>
      </Row>
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Drive?"
        description="This device stops syncing through Drive. Nothing is deleted, here or in Drive."
        confirmLabel="Disconnect"
        onConfirm={() => disconnect.mutate()}
      />
    </>
  );
}

function LanRow({ mobile }: { mobile: boolean }) {
  const info = useQuery({ queryKey: ["sync-lan-info"], queryFn: ipc.syncLanInfo, enabled: !mobile });
  const [host, setHost] = usePref("sync.lanHost");
  const [draft, setDraft] = useState<string | null>(null);
  if (!mobile) {
    const addresses = info.data?.addresses ?? [];
    return (
      <Row
        label="Direct sync"
        description={
          addresses.length ? (
            <>
              On the same Wi-Fi, a hotspot or Tailscale, your phone syncs straight with this laptop and finds it on its
              own. If it can&apos;t, enter one of these on the phone:{" "}
              <span className="font-mono text-foreground">{addresses.join(", ")}</span>
            </>
          ) : (
            "Connect to a network to sync straight with your phone."
          )
        }
      />
    );
  }
  const value = draft ?? host;
  return (
    <div className="grid gap-3 px-4 py-4 md:px-5">
      <div className="grid gap-0.5">
        <span className="text-[15px] font-medium">Direct sync with the laptop</span>
        <span className="text-[13px] leading-relaxed text-muted-foreground">
          Instant when both are on the same Wi-Fi, a hotspot or Tailscale. Kaizen finds the laptop on its own; enter an
          address only if it can&apos;t (the laptop shows them under Settings → Sync).
        </span>
      </div>
      <div className="flex gap-2">
        <Input
          aria-label="Laptop address"
          value={value}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="192.168.1.20 or 100.x.y.z"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
        />
        <Button
          variant="secondary"
          disabled={draft === null || draft.trim() === host}
          onClick={async () => {
            await setHost((draft ?? "").trim());
            setDraft(null);
            toast.success(draft?.trim() ? "Saved. Kaizen will sync directly when the laptop is reachable." : "Direct sync off");
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function BackgroundRow({ status }: { status: SyncStatus }) {
  const client = useQueryClient();
  const toggle = useMutation({
    mutationFn: ipc.syncBackgroundSet,
    onSuccess: () => client.invalidateQueries({ queryKey: ["sync-status"] }),
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Row
      inline
      label="Sync in the background"
      description={
        status.backgroundAvailable
          ? "About every 15 minutes, even when Kaizen is closed. Uses the key kept on this phone."
          : "Available once Kaizen has opened on this phone, whose stored key lets it open your data in the background."
      }
    >
      <Switch
        aria-label="Sync in the background"
        checked={status.background}
        disabled={!status.backgroundAvailable || toggle.isPending}
        onCheckedChange={(v) => toggle.mutate(v)}
      />
    </Row>
  );
}

function FolderRow() {
  const [folder, setFolder] = usePref("sync.folder");
  return (
    <Row
      label="Shared folder"
      description={
        folder ? (
          <span className="break-all">{folder}</span>
        ) : (
          "Optional: also sync through a folder another tool keeps in step (e.g. Syncthing)."
        )
      }
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          const picked = await pickFolder("Choose sync folder");
          if (picked) await setFolder(picked);
        }}
      >
        <FolderOpen />
        {folder ? "Change" : "Choose"}
      </Button>
      {folder ? (
        <Button variant="ghost" size="sm" onClick={() => setFolder("")}>
          Remove
        </Button>
      ) : null}
    </Row>
  );
}

export function SyncSection() {
  const info = useSession((s) => s.info);
  const mobile = isMobile(info);
  const client = useQueryClient();
  const running = useSyncState((s) => s.running);
  const [showCode, setShowCode] = useState(false);
  const [joining, setJoining] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const status = useQuery({ queryKey: ["sync-status"], queryFn: ipc.syncStatus, refetchInterval: running ? 1_000 : 30_000 });

  const sync = useMutation({
    mutationFn: syncNow,
    onSuccess: (report) => {
      if (!report) toast("Connect Google Drive or set up direct sync first");
      else if (report.received || report.sent) toast.success(`Synced: sent ${report.sent}, received ${report.received}`);
      else toast.success(report.peers ? "Already up to date" : "Uploaded. Waiting for your other device.");
    },
    onError: (e) => toast.error(`Sync failed: ${errorText(e)}`),
    onSettled: () => client.invalidateQueries({ queryKey: ["sync-status"] }),
  });
  const leave = useMutation({
    mutationFn: ipc.syncLeave,
    onSuccess: () => {
      client.removeQueries({ queryKey: ["sync-pair-code"] });
      client.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });

  const data = status.data;
  const lastError = data?.log[0]?.error;

  return (
    <Section title="Sync" description="Keeps your laptop and phone in step. End-to-end encrypted: only your paired devices can read it.">
      {!data ? (
        <div className="grid gap-2 p-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : !data.groupId ? (
        <Row
          label="Pair your devices"
          description={
            mobile
              ? "Show the pairing code on your laptop, then join from here."
              : "Show a pairing code here, then scan it with your phone."
          }
        >
          <Button variant={mobile ? "secondary" : "primary"} size="sm" onClick={() => setShowCode(true)}>
            <QrCode />
            Show code
          </Button>
          <Button variant={mobile ? "primary" : "secondary"} size="sm" onClick={() => setJoining(true)}>
            {mobile ? <Camera /> : null}
            Join
          </Button>
        </Row>
      ) : (
        <>
          <div className="grid gap-3 px-4 py-4 md:px-5">
            <div className="flex items-center justify-between gap-4">
              <span className="text-[15px] font-medium">Devices</span>
              <Button variant="ghost" size="sm" onClick={() => setShowCode(true)}>
                <QrCode />
                Add device
              </Button>
            </div>
            {data.peers.length ? (
              <ul className="grid gap-1.5">
                {data.peers.map((p) => (
                  <li key={p.deviceId} className="flex items-center gap-3 rounded-xl bg-surface-muted/60 px-3 py-2.5">
                    <PeerIcon platform={p.platform} />
                    <span className="grid min-w-0">
                      <span className="text-[14px] font-medium">{p.name}</span>
                      <span className="text-[12px] text-muted-foreground">Last change received {ago(p.lastReceivedAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                No other device has synced yet. Join from your other device with the pairing code, and connect the same
                Google account there.
              </p>
            )}
          </div>
          <DriveRow status={data} mobile={mobile} />
          <LanRow mobile={mobile} />
          {mobile ? <BackgroundRow status={data} /> : <FolderRow />}
          <Row
            label="Sync now"
            description={
              lastError ? (
                <span className="flex items-start gap-1.5 text-danger">
                  <WarningCircle className="mt-0.5 size-4 shrink-0" />
                  {lastError}
                </span>
              ) : data.log[0] ? (
                `Last synced ${ago(data.log[0].at)}. Runs automatically${data.background ? "" : " while Kaizen is open"}.`
              ) : (
                `Runs automatically${data.background ? "" : " while Kaizen is open"}.`
              )
            }
          >
            <Button variant="secondary" size="sm" loading={sync.isPending || running} onClick={() => sync.mutate()}>
              <ArrowsClockwise />
              Sync
            </Button>
          </Row>
          {data.log.length ? (
            <details className="group px-4 py-3 md:px-5">
              <summary className="cursor-pointer list-none text-[14px] font-medium text-muted-foreground hover:text-foreground">
                History
              </summary>
              <ul className="mt-2 divide-y divide-border">
                {data.log.slice(0, 15).map((entry, i) => (
                  <LogLine key={`${entry.at}-${i}`} entry={entry} />
                ))}
              </ul>
            </details>
          ) : null}
          <Row label="Unpair this device" description="Stops syncing. Data on this device stays.">
            <Button variant="danger-ghost" size="sm" onClick={() => setConfirmLeave(true)}>
              <LinkBreak />
              Unpair
            </Button>
          </Row>
        </>
      )}

      <PairCodeDialog open={showCode} onOpenChange={setShowCode} />
      <JoinDialog open={joining} onOpenChange={setJoining} mobile={mobile} />
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Unpair this device?"
        description="It stops syncing with your other devices. Nothing is deleted. You can pair again later."
        confirmLabel="Unpair"
        onConfirm={() => leave.mutate()}
      />
    </Section>
  );
}
