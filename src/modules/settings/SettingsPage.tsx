import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bell,
  BellRinging,
  CheckCircle,
  CloudArrowUp,
  Desktop,
  DownloadSimple,
  FileText,
  FolderOpen,
  GearSix,
  Moon,
  Sun,
  Trash,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { NativeSelect, Segmented, Skeleton, Switch } from "@/components/ui/controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { DateTimeInput } from "@/components/ui/kit";
import { notificationsAllowed, requestNotifications, syncNotifications } from "@/core/notifications/scheduler";
import { usePref } from "@/core/db/prefs";
import { runSelfTest, type SelfTestStep } from "@/core/db/selftest";
import { runBackupNow } from "@/core/backup/useScheduledBackup";
import { isMobile, useSession } from "@/core/security/session";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { setTheme, useTheme } from "@/core/theme";
import { AppError, ipc, type BackupInfo } from "@/lib/ipc";
import { biometricAvailable, biometricPrompt, pickFolder } from "@/lib/native";
import { formatBytes, formatDateTime } from "@/lib/utils";
import { Row, Section } from "./layout";
import { SyncSection } from "./SyncSection";

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------

function AppearanceSection() {
  const theme = useTheme();
  return (
    <Section title="Appearance">
      <Row label="Theme" description="Saved on this device.">
        <Segmented
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Light", icon: <Sun /> },
            { value: "dark", label: "Dark", icon: <Moon /> },
            { value: "system", label: "System", icon: <Desktop /> },
          ]}
        />
      </Row>
    </Section>
  );
}

function SecuritySection() {
  const info = useSession((s) => s.info);
  const mobile = isMobile(info);
  const client = useQueryClient();
  const [timeout, setTimeoutPref] = usePref("lock.timeoutMinutes");
  const status = useQuery({ queryKey: ["vault-status"], queryFn: ipc.vaultStatus });
  const biometric = useQuery({ queryKey: ["biometric-available"], queryFn: biometricAvailable, enabled: mobile });

  const toggleDevice = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (enabled && mobile && !(await biometricPrompt("Confirm to enable fingerprint unlock"))) {
        throw new Error("Fingerprint not confirmed");
      }
      await ipc.vaultSetDeviceUnlock(enabled);
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["vault-status"] });
      // Background sync depends on it.
      client.invalidateQueries({ queryKey: ["sync-status"] });
    },
    onError: (e) => {
      if (!(e instanceof AppError && e.code === "cancelled")) toast.error(errorText(e));
    },
  });

  const touchId = !mobile && !!info?.touchId;
  const deviceLabel = mobile ? "Unlock with fingerprint" : touchId ? "Unlock with Touch ID" : "Remember on this computer";
  const deviceDescription = mobile
    ? "Use your fingerprint instead of the passphrase."
    : touchId
      ? "Use Touch ID (or your Mac password) instead of the passphrase. The key is kept in your keychain."
      : "Unlock with one click. The key is kept in your system keychain.";

  return (
    <Section title="Security" description="Your data is encrypted with your passphrase.">
      {mobile && biometric.data === false ? (
        <Row label={deviceLabel} description="No fingerprint is set up on this phone." />
      ) : (
        <Row label={deviceLabel} description={deviceDescription} inline>
          <Switch
            aria-label={deviceLabel}
            checked={status.data?.deviceUnlock ?? false}
            disabled={status.isLoading || toggleDevice.isPending}
            onCheckedChange={(v) => toggleDevice.mutate(v)}
          />
        </Row>
      )}
      <Row label="Auto-lock" description="Lock after this long without activity.">
        <NativeSelect
          aria-label="Auto-lock"
          value={timeout}
          onChange={async (e) => {
            const minutes = Number(e.target.value);
            await setTimeoutPref(minutes);
            window.dispatchEvent(new CustomEvent("kaizen:lock-timeout", { detail: minutes }));
          }}
        >
          <option value={1}>1 minute</option>
          <option value={5}>5 minutes</option>
          <option value={15}>15 minutes</option>
          <option value={60}>1 hour</option>
          <option value={0}>Never</option>
        </NativeSelect>
      </Row>
    </Section>
  );
}

function ContestLead() {
  const [lead, setLead] = usePref("notify.contestsLead");
  const [on] = usePref("notify.contests");
  if (!on) return null;
  return (
    <Row label="Contest reminder" description="How long before the start." inline>
      <NativeSelect aria-label="Contest reminder" value={String(lead)} onChange={(e) => void setLead(Number(e.target.value))}>
        {[10, 15, 30, 60, 120].map((m) => (
          <option key={m} value={m}>
            {m >= 60 ? `${m / 60} h before` : `${m} min before`}
          </option>
        ))}
      </NativeSelect>
    </Row>
  );
}

function NotifyToggle({ prefKey, label, description }: { prefKey: "notify.classes" | "notify.attendance" | "notify.habits" | "notify.tasks" | "notify.dates" | "notify.debts" | "notify.streaks" | "notify.goals" | "notify.contests"; label: string; description: string }) {
  const [value, setValue] = usePref(prefKey);
  return (
    <Row label={label} description={description} inline>
      <Switch checked={value} onCheckedChange={(v) => setValue(v)} aria-label={label} />
    </Row>
  );
}

function NotificationsSection() {
  const info = useSession((s) => s.info);
  const client = useQueryClient();
  const allowed = useQuery({ queryKey: ["notify-allowed"], queryFn: notificationsAllowed });
  const [digest, setDigest] = usePref("notify.digest");
  const platform = info?.platform === "android" ? "android" : "desktop";

  const enable = useMutation({
    mutationFn: requestNotifications,
    onSuccess: async (granted) => {
      client.setQueryData(["notify-allowed"], granted);
      if (granted) {
        await syncNotifications(platform);
        toast.success("Reminders are on");
      } else toast.error("Notifications are blocked", { description: "Allow them for Kaizen in system settings." });
    },
  });

  async function test() {
    const n = await import("@tauri-apps/plugin-notification");
    n.sendNotification({ title: "Kaizen", body: "Notifications are working." });
  }

  return (
    <Section title="Notifications" description={platform === "android" ? "Scheduled on the phone, so they arrive even when Kaizen is closed." : "Delivered while Kaizen is running."}>
      <Row label="Allow notifications" description={allowed.data ? "Allowed on this device." : "Kaizen needs permission to remind you."}>
        {allowed.data ? (
          <Button variant="secondary" size="sm" onClick={test}>
            <BellRinging />
            Send a test
          </Button>
        ) : (
          <Button size="sm" loading={enable.isPending} onClick={() => enable.mutate()}>
            <Bell />
            Turn on
          </Button>
        )}
      </Row>
      <NotifyToggle prefKey="notify.classes" label="Before each class" description="Uses the reminder time in semester settings." />
      <NotifyToggle prefKey="notify.attendance" label="Attendance check" description="When a class ends, if it isn't marked." />
      <NotifyToggle prefKey="notify.tasks" label="Task reminders" description="For tasks with a reminder set." />
      <NotifyToggle prefKey="notify.habits" label="Habit reminders" description="Only if the habit isn't done yet." />
      <NotifyToggle prefKey="notify.dates" label="Important dates" description="At the times chosen for each date." />
      <NotifyToggle prefKey="notify.debts" label="Debts due" description="On the due date." />
      <NotifyToggle prefKey="notify.streaks" label="Streaks" description="At 8:30 pm if a streak of 3+ days isn't done yet." />
      <NotifyToggle prefKey="notify.goals" label="Goals" description="A week and a day before a goal's finish date." />
      <NotifyToggle prefKey="notify.contests" label="Contests" description="Before contests on the sites chosen in Practice." />
      <ContestLead />
      <Row label="Morning summary" description="Classes, tasks and habits for the day.">
        <DateTimeInput type="time" aria-label="Morning summary time" className="h-9 w-32" value={digest} onChange={(e) => setDigest(e.target.value)} />
        {digest ? (
          <Button variant="ghost" size="sm" onClick={() => setDigest("")}>
            Off
          </Button>
        ) : null}
      </Row>
    </Section>
  );
}

function BackupsSection() {
  const info = useSession((s) => s.info);
  const lockAndRefresh = useSession((s) => s.refresh);
  const mobile = isMobile(info);
  const client = useQueryClient();
  const [dir, setDir] = usePref("backup.dir");
  const [frequency, setFrequency] = usePref("backup.frequency");
  const [keep, setKeep] = usePref("backup.keep");
  const [lastAt] = usePref("backup.lastAt");
  const [restoreTarget, setRestoreTarget] = useState<BackupInfo | null>(null);

  const list = useQuery({ queryKey: ["backups", dir || "default"], queryFn: () => ipc.backupList(dir) });

  const backupNow = useMutation({
    mutationFn: runBackupNow,
    onSuccess: () => {
      toast.success("Backup saved");
      client.invalidateQueries({ queryKey: ["backups"] });
      client.invalidateQueries({ queryKey: ["pref", "backup.lastAt"] });
    },
    onError: (e) => toast.error(`Backup failed: ${errorText(e)}`),
  });

  const restore = useMutation({
    mutationFn: async (backup: BackupInfo) => {
      await ipc.backupRestore(backup.path);
      await lockAndRefresh();
    },
    onError: (e) => toast.error(`Restore failed: ${errorText(e)}`),
  });

  return (
    <Section title="Backups" description="Encrypted copies of everything, including attachments.">
      <Row
        label="Folder"
        description={<span className="break-all">{dir || info?.defaultBackupDir || "Default folder"}</span>}
      >
        {!mobile ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const picked = await pickFolder("Choose backup folder");
                if (picked) await setDir(picked);
              }}
            >
              <FolderOpen />
              Change
            </Button>
            {dir ? (
              <Button variant="ghost" size="sm" onClick={() => setDir("")}>
                Reset
              </Button>
            ) : null}
          </>
        ) : null}
      </Row>
      <Row label="Schedule" description={lastAt ? `Last backup ${formatDateTime(lastAt)}` : "No backup yet"}>
        <NativeSelect
          aria-label="Backup schedule"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as typeof frequency)}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="off">Off</option>
        </NativeSelect>
        <NativeSelect aria-label="Backups to keep" value={keep} onChange={(e) => setKeep(Number(e.target.value))}>
          {[3, 5, 10, 20, 50].map((n) => (
            <option key={n} value={n}>
              Keep {n}
            </option>
          ))}
        </NativeSelect>
      </Row>
      <Row label="Back up now">
        <Button variant="secondary" size="sm" loading={backupNow.isPending} onClick={() => backupNow.mutate()}>
          <CloudArrowUp />
          Back up
        </Button>
      </Row>
      <div className="px-4 py-4 md:px-5">
        <p className="mb-3 text-[15px] font-medium">Restore</p>
        {list.isLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : list.data?.length ? (
          <ul className="grid gap-1.5">
            {list.data.map((b) => (
              <li key={b.path} className="flex items-center justify-between gap-4 rounded-lg bg-surface-muted px-3 py-2.5">
                <span className="grid">
                  <span className="text-[14px] font-medium">{formatDateTime(b.createdAt)}</span>
                  <span className="text-[12px] text-muted-foreground">{formatBytes(b.sizeBytes)}</span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => setRestoreTarget(b)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px] text-muted-foreground">No backups in this folder yet.</p>
        )}
      </div>

      <Dialog open={!!restoreTarget} onOpenChange={(open) => !open && setRestoreTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore this backup?</DialogTitle>
            <DialogDescription>
              Everything on this device is replaced with the backup from{" "}
              {restoreTarget ? formatDateTime(restoreTarget.createdAt) : ""}. Kaizen locks afterwards; unlock with the
              passphrase that was in use then.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRestoreTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={restore.isPending}
              onClick={() => restoreTarget && restore.mutate(restoreTarget)}
            >
              Replace and restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function DataSection() {
  const refresh = useSession((s) => s.refresh);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  const exportJson = useMutation({
    mutationFn: () => ipc.dataExportJson(null),
    onSuccess: (path) => toast.success("Export saved", { description: path }),
    onError: (e) => toast.error(`Export failed: ${errorText(e)}`),
  });

  const wipe = useMutation({
    mutationFn: async () => {
      await ipc.dataWipe();
      await refresh();
    },
    onError: (e) => toast.error(`Erase failed: ${errorText(e)}`),
  });

  return (
    <Section title="Your data">
      <Row label="Export as JSON" description="A plain, unencrypted copy of every table.">
        <Button variant="secondary" size="sm" loading={exportJson.isPending} onClick={() => exportJson.mutate()}>
          <DownloadSimple />
          Export
        </Button>
      </Row>
      <Row label="Erase this device" description="Deletes the database and keys here. Backups are kept.">
        <Button variant="danger-ghost" size="sm" onClick={() => setWipeOpen(true)}>
          <Trash />
          Erase
        </Button>
      </Row>

      <Dialog
        open={wipeOpen}
        onOpenChange={(open) => {
          setWipeOpen(open);
          if (!open) setConfirmText("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase everything on this device?</DialogTitle>
            <DialogDescription>
              This can't be undone. Make sure you have a recent backup. Backups in the backup folder are not touched.
            </DialogDescription>
          </DialogHeader>
          <Field label='Type "erase" to confirm' htmlFor="confirm-erase">
            <Input
              id="confirm-erase"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setWipeOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={confirmText.trim().toLowerCase() !== "erase"}
              loading={wipe.isPending}
              onClick={() => wipe.mutate()}
            >
              Erase this device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function DiagnosticsSection() {
  const info = useSession((s) => s.info);
  const [steps, setSteps] = useState<SelfTestStep[] | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const test = useMutation({ mutationFn: runSelfTest, onSuccess: setSteps });
  const logs = useQuery({ queryKey: ["logs"], queryFn: () => ipc.logsTail(300), enabled: logsOpen });

  return (
    <Section title="Diagnostics">
      <div className="px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-0.5">
            <span className="text-[15px] font-medium">Database check</span>
            <span className="text-[13px] text-muted-foreground">Writes and removes a test record.</span>
          </div>
          <Button variant="secondary" size="sm" loading={test.isPending} onClick={() => test.mutate()}>
            Run check
          </Button>
        </div>
        {steps ? (
          <ul className="mt-4 grid gap-2">
            {steps.map((s) => (
              <li key={s.name} className="flex items-center gap-2.5 text-[14px]">
                {s.ok ? (
                  <CheckCircle size={18} weight="fill" className="text-success" />
                ) : (
                  <XCircle size={18} weight="fill" className="text-danger" />
                )}
                <span>{s.name}</span>
                {s.detail ? <span className="truncate text-muted-foreground">{s.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Row label="Logs" description={<span className="break-all">{info?.logDir}</span>}>
        <Button variant="secondary" size="sm" onClick={() => setLogsOpen(true)}>
          <FileText />
          View
        </Button>
      </Row>
      <Row label="Version" description={`Kaizen ${info?.version ?? ""} on ${info?.platform ?? ""}`} />

      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Recent logs</DialogTitle>
          </DialogHeader>
          {logs.isLoading ? (
            <Skeleton className="h-64" />
          ) : logs.isError ? (
            <p className="flex items-center gap-2 text-[14px] text-danger">
              <WarningCircle size={18} />
              {errorText(logs.error)}
            </p>
          ) : (
            <pre className="max-h-[60dvh] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-muted p-4 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
              {logs.data || "No log entries yet."}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </Section>
  );
}

export function SettingsPage() {
  return (
    <Page hue="#7d8696">
      <PageHeader title="Settings" description="Appearance, security, sync, backups and your data." icon={GearSix} hue="#7d8696" />
      <div className="mt-8 grid gap-10">
        <AppearanceSection />
        <SecuritySection />
        <SyncSection />
        <NotificationsSection />
        <BackupsSection />
        <DataSection />
        <DiagnosticsSection />
      </div>
    </Page>
  );
}
