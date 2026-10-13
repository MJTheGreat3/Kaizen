import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowCounterClockwise, Check, Copy, Eye, EyeSlash, Fingerprint, FolderOpen, Key } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Skeleton, Switch } from "@/components/ui/controls";
import { AppError, ipc } from "@/lib/ipc";
import { biometricAvailable, biometricPrompt, pickFolder } from "@/lib/native";
import { cn, formatBytes, formatDateTime } from "@/lib/utils";
import { isMobile, useSession } from "./session";

const MIN_PASSPHRASE = 8;

function message(e: unknown): string {
  if (e instanceof AppError) {
    if (e.code === "wrong_secret") return "That doesn't match. Check it and try again.";
    return e.message.charAt(0).toUpperCase() + e.message.slice(1);
  }
  return String(e);
}

function Shell({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pt-safe pb-safe">
      <motion.main
        initial={reduce ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-[400px] py-10"
      >
        <div className="mb-8 flex items-center gap-3">
          <div
            aria-hidden
            className="grid size-11 place-items-center rounded-xl bg-accent text-[17px] font-semibold text-accent-foreground shadow-soft"
          >
            改
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Kaizen</span>
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{title}</h1>
        <div className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{description}</div>
        <div className="mt-8">{children}</div>
      </motion.main>
    </div>
  );
}

function PassphraseInput({
  id,
  value,
  onChange,
  autoFocus,
  invalid,
  autoComplete,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  autoComplete: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide passphrase" : "Show passphrase"}
        className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-foreground"
      >
        {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

export function SetupScreen() {
  const onUnlocked = useSession((s) => s.onUnlocked);
  const [mode, setMode] = useState<"create" | "restore">("create");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (mode === "restore") return <RestoreScreen onBack={() => setMode("create")} />;

  const tooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE;
  const mismatch = confirm.length > 0 && confirm !== passphrase;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (passphrase.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters.`);
    if (passphrase !== confirm) return setError("The two passphrases don't match.");
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await ipc.vaultSetup(passphrase));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell
      title="Set up Kaizen"
      description="Choose a passphrase. It encrypts everything on this device and is never stored anywhere."
    >
      <form onSubmit={submit} className="grid gap-5">
        <Field
          label="Passphrase"
          htmlFor="passphrase"
          hint={`At least ${MIN_PASSPHRASE} characters. A short sentence works well.`}
          error={tooShort ? `Use at least ${MIN_PASSPHRASE} characters.` : null}
        >
          <PassphraseInput
            id="passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoFocus
            invalid={tooShort}
            autoComplete="new-password"
          />
        </Field>
        <Field
          label="Confirm passphrase"
          htmlFor="confirm"
          error={mismatch ? "The two passphrases don't match." : error}
        >
          <PassphraseInput
            id="confirm"
            value={confirm}
            onChange={setConfirm}
            invalid={mismatch}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" size="lg" loading={busy} className="mt-1">
          Create vault
        </Button>
        <Button type="button" variant="ghost" onClick={() => setMode("restore")}>
          <ArrowCounterClockwise />
          Restore from a backup
        </Button>
      </form>
    </Shell>
  );
}

export function RecoveryKeyScreen({ recoveryKey }: { recoveryKey: string }) {
  const info = useSession((s) => s.info);
  const acknowledge = useSession((s) => s.acknowledgeRecoveryKey);
  const [copied, setCopied] = useState(false);
  const [stored, setStored] = useState(false);
  const [fingerprint, setFingerprint] = useState(true);
  const mobile = isMobile(info);
  const { data: canUseBiometric } = useQuery({
    queryKey: ["biometric-available"],
    queryFn: biometricAvailable,
    enabled: mobile,
  });
  const [busy, setBusy] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function finish() {
    setBusy(true);
    try {
      if (mobile && canUseBiometric && fingerprint) await ipc.vaultSetDeviceUnlock(true);
    } finally {
      setBusy(false);
      acknowledge();
    }
  }

  return (
    <Shell
      title="Save your recovery key"
      description="If you forget your passphrase, this key is the only way back in. Write it down or keep it in a password manager. It won't be shown again."
    >
      <div className="grid gap-6">
        <div className="rounded-xl border border-border bg-surface p-4 shadow-soft">
          <p
            aria-label={recoveryKey}
            className="flex flex-wrap justify-center gap-x-2.5 gap-y-1 font-mono text-[17px] leading-relaxed tracking-wide text-foreground select-all"
          >
            {recoveryKey.split("-").map((group, i) => (
              <span key={i}>{group}</span>
            ))}
          </p>
          <div className="mt-3 flex justify-center">
            <Button variant="ghost" size="sm" onClick={copy}>
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        {mobile && canUseBiometric ? (
          <label className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3">
            <span className="flex items-center gap-3 text-[15px]">
              <Fingerprint size={22} className="text-accent" />
              Unlock with fingerprint
            </span>
            <Switch checked={fingerprint} onCheckedChange={setFingerprint} aria-label="Unlock with fingerprint" />
          </label>
        ) : null}

        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-snug">
          <input
            type="checkbox"
            checked={stored}
            onChange={(e) => setStored(e.target.checked)}
            className="mt-0.5 size-[18px] accent-[var(--accent)]"
          />
          I've stored my recovery key somewhere safe.
        </label>

        <Button size="lg" disabled={!stored} loading={busy} onClick={finish}>
          Continue
        </Button>
      </div>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------

export function UnlockScreen({ deviceUnlock }: { deviceUnlock: boolean }) {
  const info = useSession((s) => s.info);
  const onUnlocked = useSession((s) => s.onUnlocked);
  const mobile = isMobile(info);
  const [mode, setMode] = useState<"unlock" | "recover">("unlock");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoPrompted = useRef(false);

  async function quickUnlock() {
    setError(null);
    if (mobile && !(await biometricPrompt("Unlock Kaizen"))) return;
    setBusy(true);
    try {
      onUnlocked(await ipc.vaultUnlockDevice());
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  // On the phone, show the fingerprint prompt straight away.
  useEffect(() => {
    if (mobile && deviceUnlock && !autoPrompted.current) {
      autoPrompted.current = true;
      void quickUnlock();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, deviceUnlock]);

  if (mode === "recover") return <RecoverScreen onBack={() => setMode("unlock")} />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await ipc.vaultUnlock(passphrase));
    } catch (err) {
      setError(message(err));
      setPassphrase("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Welcome back" description="Kaizen is locked.">
      <div className="grid gap-5">
        {deviceUnlock ? (
          <>
            <Button size="lg" onClick={quickUnlock} loading={busy && !passphrase}>
              {mobile ? <Fingerprint /> : <Key />}
              {mobile ? "Unlock with fingerprint" : "Unlock"}
            </Button>
            <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or use your passphrase
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        ) : null}
        <form onSubmit={submit} className="grid gap-5">
          <Field label="Passphrase" htmlFor="unlock-passphrase" error={error}>
            <PassphraseInput
              id="unlock-passphrase"
              value={passphrase}
              onChange={setPassphrase}
              autoFocus={!mobile || !deviceUnlock}
              invalid={!!error}
              autoComplete="current-password"
            />
          </Field>
          <Button
            type="submit"
            size="lg"
            variant={deviceUnlock ? "secondary" : "primary"}
            loading={busy && !!passphrase}
            disabled={!passphrase}
          >
            Unlock
          </Button>
        </form>
        <Button variant="ghost" onClick={() => setMode("recover")}>
          Forgot passphrase?
        </Button>
      </div>
    </Shell>
  );
}

function RecoverScreen({ onBack }: { onBack: () => void }) {
  const onUnlocked = useSession((s) => s.onUnlocked);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (passphrase.length < MIN_PASSPHRASE) return setError(`Use at least ${MIN_PASSPHRASE} characters.`);
    setBusy(true);
    setError(null);
    try {
      onUnlocked(await ipc.vaultRecover(recoveryKey, passphrase));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Reset passphrase" description="Enter your recovery key and choose a new passphrase.">
      <form onSubmit={submit} className="grid gap-5">
        <Field label="Recovery key" htmlFor="recovery-key" hint="Dashes and letter case don't matter.">
          <Input
            id="recovery-key"
            value={recoveryKey}
            onChange={(e) => setRecoveryKey(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            className="font-mono uppercase"
          />
        </Field>
        <Field label="New passphrase" htmlFor="new-passphrase" error={error}>
          <PassphraseInput
            id="new-passphrase"
            value={passphrase}
            onChange={setPassphrase}
            invalid={!!error}
            autoComplete="new-password"
          />
        </Field>
        <Button type="submit" size="lg" loading={busy} disabled={!recoveryKey || !passphrase}>
          Reset and unlock
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </form>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Restore (first run)
// ---------------------------------------------------------------------------

function RestoreScreen({ onBack }: { onBack: () => void }) {
  const info = useSession((s) => s.info);
  const refresh = useSession((s) => s.refresh);
  const [dir, setDir] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const backups = useQuery({ queryKey: ["backups", dir ?? "default"], queryFn: () => ipc.backupList(dir) });
  const mobile = isMobile(info);

  async function restore(path: string) {
    setBusyPath(path);
    setError(null);
    try {
      await ipc.backupRestore(path);
      await refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusyPath(null);
    }
  }

  return (
    <Shell
      title="Restore from a backup"
      description="Pick a backup. You'll unlock it with the passphrase that was in use when it was made."
    >
      <div className="grid gap-4">
        {!mobile ? (
          <Button variant="secondary" onClick={async () => setDir((await pickFolder("Choose backup folder")) ?? dir)}>
            <FolderOpen />
            {dir ? "Choose another folder" : "Choose backup folder"}
          </Button>
        ) : null}
        <p className="truncate text-[13px] text-muted-foreground" title={dir ?? info?.defaultBackupDir}>
          Looking in {dir ?? "the default backup folder"}
        </p>

        <div className="grid gap-2">
          {backups.isLoading ? (
            <>
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </>
          ) : backups.data?.length ? (
            backups.data.map((b) => (
              <button
                key={b.path}
                onClick={() => restore(b.path)}
                disabled={!!busyPath}
                className={cn(
                  "flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-soft transition-colors hover:bg-surface-muted disabled:opacity-60",
                )}
              >
                <span className="grid gap-0.5">
                  <span className="text-[15px] font-medium">{formatDateTime(b.createdAt)}</span>
                  <span className="text-[13px] text-muted-foreground">{formatBytes(b.sizeBytes)}</span>
                </span>
                <span className="text-[13px] font-medium text-accent">
                  {busyPath === b.path ? "Restoring…" : "Restore"}
                </span>
              </button>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[14px] text-muted-foreground">
              No backups found here.
            </p>
          )}
        </div>

        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </Shell>
  );
}

export function LoadingScreen() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center">
      <div className="grid w-full max-w-[400px] gap-4 px-4">
        <Skeleton className="size-11 rounded-xl" />
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-11" />
      </div>
    </div>
  );
}
