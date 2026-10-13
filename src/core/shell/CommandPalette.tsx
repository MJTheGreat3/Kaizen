import { useEffect } from "react";
import { Command } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useNavigate } from "@tanstack/react-router";
import { CloudArrowUp, GearSix, Lock, MagnifyingGlass, MoonStars } from "@phosphor-icons/react";
import { toast } from "sonner";

import { Kbd } from "@/components/ui/controls";
import { ModuleTile } from "@/components/visual";
import { modules } from "@/modules/registry";
import { cycleTheme } from "@/core/theme";
import { useSession } from "@/core/security/session";
import { runBackupNow } from "@/core/backup/useScheduledBackup";
import { usePalette } from "./palette";

const itemClass =
  "flex h-11 cursor-pointer items-center gap-3 rounded-[10px] px-2.5 text-[14px] text-foreground transition-colors data-[selected=true]:bg-surface-muted [&>svg]:size-[18px] [&>svg]:text-muted-foreground";

export function CommandPalette() {
  const { open, setOpen } = usePalette();
  const navigate = useNavigate();
  const lock = useSession((s) => s.lock);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(!usePalette.getState().open);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  function run(action: () => void | Promise<void>) {
    setOpen(false);
    void action();
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[12dvh] z-50 w-[calc(100%-2rem)] max-w-[560px] -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <Command loop className="flex flex-col">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <MagnifyingGlass size={18} className="text-muted-foreground" />
              <Command.Input
                autoFocus
                placeholder="Go to or do…"
                className="h-13 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
              />
              <Kbd>esc</Kbd>
            </div>
            <Command.List className="max-h-[min(60dvh,420px)] overflow-y-auto p-2">
              <Command.Empty className="px-3 py-8 text-center text-[14px] text-muted-foreground">
                Nothing matches. Searching your data arrives in Phase 3.
              </Command.Empty>
              <Command.Group
                heading="Go to"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {modules.map((m) => (
                  <Command.Item
                    key={m.id}
                    value={`go ${m.title} ${m.summary}`}
                    onSelect={() => run(() => navigate({ to: m.path }))}
                    className={itemClass}
                  >
                    <ModuleTile icon={m.icon} hue={m.hue} size="sm" />
                    <span className="flex-1">{m.title}</span>
                    <span className="hidden text-[12px] text-muted-foreground sm:inline">{m.summary}</span>
                  </Command.Item>
                ))}
                <Command.Item value="go settings" onSelect={() => run(() => navigate({ to: "/settings" }))} className={itemClass}>
                  <GearSix />
                  Settings
                </Command.Item>
              </Command.Group>
              <Command.Group
                heading="Actions"
                className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                <Command.Item value="back up now backup" onSelect={() => run(async () => {
                  const id = toast.loading("Backing up…");
                  try {
                    await runBackupNow();
                    toast.success("Backup saved", { id });
                  } catch (e) {
                    toast.error(`Backup failed: ${String(e)}`, { id });
                  }
                })} className={itemClass}>
                  <CloudArrowUp />
                  Back up now
                </Command.Item>
                <Command.Item value="toggle theme dark light" onSelect={() => run(cycleTheme)} className={itemClass}>
                  <MoonStars />
                  Toggle dark mode
                </Command.Item>
                <Command.Item value="lock now" onSelect={() => run(lock)} className={itemClass}>
                  <Lock />
                  Lock now
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
