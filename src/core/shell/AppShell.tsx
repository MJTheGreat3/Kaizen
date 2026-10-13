import { useState, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { DotsThreeOutline, GearSix, Lock, MagnifyingGlass } from "@phosphor-icons/react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/controls";
import { cn } from "@/lib/utils";
import { groupLabels, modules, type ModuleGroup } from "@/modules/registry";
import { useSession } from "@/core/security/session";
import { CommandPalette } from "./CommandPalette";
import { usePalette } from "./palette";

const groups: ModuleGroup[] = ["daily", "track", "create"];

function useActivePath() {
  return useRouterState({ select: (s) => s.location.pathname });
}

function isActive(current: string, path: string) {
  return path === "/" ? current === "/" : current.startsWith(path);
}

function SidebarLink({ to, icon, label, active }: { to: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex h-9 items-center gap-3 rounded-lg px-2.5 text-[14px] transition-colors [&_svg]:size-[18px]",
        active
          ? "bg-surface font-medium text-foreground shadow-soft"
          : "text-muted-foreground hover:bg-surface/60 hover:text-foreground",
      )}
    >
      <span className={cn(active ? "text-accent" : "text-muted-foreground group-hover:text-foreground")}>{icon}</span>
      {label}
    </Link>
  );
}

function Sidebar() {
  const path = useActivePath();
  const openPalette = usePalette((s) => s.setOpen);
  const lock = useSession((s) => s.lock);
  const mac = navigator.userAgent.includes("Mac");

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[248px] shrink-0 flex-col border-r border-border bg-surface-muted/60 px-3 pt-safe md:flex">
      <div className="flex items-center gap-2.5 px-2.5 pb-4 pt-5">
        <div aria-hidden className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-semibold text-accent-foreground">
          改
        </div>
        <span className="text-[15px] font-semibold tracking-tight">Kaizen</span>
      </div>

      <button
        onClick={() => openPalette(true)}
        className="mb-4 flex h-9 items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 text-[14px] text-muted-foreground shadow-soft transition-colors hover:text-foreground"
      >
        <MagnifyingGlass size={16} />
        <span className="flex-1 text-left">Search</span>
        <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </button>

      <nav className="flex-1 overflow-y-auto pb-4" aria-label="Modules">
        {groups.map((group) => (
          <div key={group} className="mb-4">
            <p className="px-2.5 pb-1.5 text-[12px] font-medium text-muted-foreground/80">{groupLabels[group]}</p>
            <div className="grid gap-0.5">
              {modules
                .filter((m) => m.group === group)
                .map((m) => (
                  <SidebarLink key={m.id} to={m.path} icon={<m.icon />} label={m.title} active={isActive(path, m.path)} />
                ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="grid gap-0.5 border-t border-border py-3 pb-safe">
        <SidebarLink to="/settings" icon={<GearSix />} label="Settings" active={isActive(path, "/settings")} />
        <button
          onClick={() => void lock()}
          className="flex h-9 items-center gap-3 rounded-lg px-2.5 text-[14px] text-muted-foreground transition-colors hover:bg-surface/60 hover:text-foreground [&_svg]:size-[18px]"
        >
          <Lock />
          Lock
        </button>
      </div>
    </aside>
  );
}

function MobileTopBar() {
  const openPalette = usePalette((s) => s.setOpen);
  const lock = useSession((s) => s.lock);

  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 pt-safe backdrop-blur-md md:hidden">
      <div className="flex h-13 items-center justify-between px-4">
        <span className="flex items-center gap-2.5">
          <span aria-hidden className="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-semibold text-accent-foreground">
            改
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Kaizen</span>
        </span>
        <div className="flex items-center gap-1">
          <button aria-label="Search" onClick={() => openPalette(true)} className="grid size-10 place-items-center rounded-lg text-muted-foreground active:bg-surface-muted">
            <MagnifyingGlass size={20} />
          </button>
          <button aria-label="Lock" onClick={() => void lock()} className="grid size-10 place-items-center rounded-lg text-muted-foreground active:bg-surface-muted">
            <Lock size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}

function BottomNav() {
  const path = useActivePath();
  const reduce = useReducedMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = modules.filter((m) => m.mobilePrimary);
  const inMore = !primary.some((m) => isActive(path, m.path));

  const tabClass = "relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium";
  const indicator = (
    <motion.span
      layoutId="bottom-nav-indicator"
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
      className="absolute top-2 h-8 w-14 rounded-full bg-accent-soft"
    />
  );

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 pb-safe backdrop-blur-md md:hidden"
      >
        <div className="flex px-2">
          {primary.map((m) => {
            const active = isActive(path, m.path);
            return (
              <Link key={m.id} to={m.path} className={cn(tabClass, active ? "text-foreground" : "text-muted-foreground")}>
                {active ? indicator : null}
                <m.icon size={22} weight={active ? "fill" : "regular"} className={cn("relative", active && "text-accent-soft-foreground")} />
                <span className="relative">{m.title}</span>
              </Link>
            );
          })}
          <button onClick={() => setMoreOpen(true)} className={cn(tabClass, inMore ? "text-foreground" : "text-muted-foreground")}>
            {inMore ? indicator : null}
            <DotsThreeOutline size={22} weight={inMore ? "fill" : "regular"} className={cn("relative", inMore && "text-accent-soft-foreground")} />
            <span className="relative">More</span>
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent className="inset-x-0 bottom-0 top-auto left-0 w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl border-x-0 border-b-0 pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom-8 data-[state=open]:zoom-in-100 data-[state=closed]:slide-out-to-bottom-8 data-[state=closed]:zoom-out-100">
          <DialogTitle>All modules</DialogTitle>
          <div className="grid grid-cols-3 gap-2">
            {[...modules.filter((m) => !m.mobilePrimary), { id: "settings", path: "/settings", title: "Settings", icon: GearSix }].map((m) => {
              const active = isActive(path, m.path);
              return (
                <Link
                  key={m.id}
                  to={m.path}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border text-[13px] font-medium transition-colors",
                    active ? "border-accent/30 bg-accent-soft text-accent-soft-foreground" : "border-border bg-surface-muted text-foreground active:bg-surface",
                  )}
                >
                  <m.icon size={24} />
                  {m.title}
                </Link>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AppShell() {
  const path = useActivePath();
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-[100dvh] pl-safe pr-safe">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        <motion.main
          key={path}
          initial={reduce ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"
        >
          <Outlet />
        </motion.main>
      </div>
      <BottomNav />
      <CommandPalette />
    </div>
  );
}
