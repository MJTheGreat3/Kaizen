import { useState, type ReactNode } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { motion } from "motion/react";
import { DotsThreeOutline, GearSix, Lock, MagnifyingGlass } from "@phosphor-icons/react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/controls";
import { BrandMark, ModuleTile } from "@/components/visual";
import { ease, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { groupLabels, modules, type ModuleGroup } from "@/modules/registry";
import { useSession } from "@/core/security/session";
import { SyncButton } from "@/core/sync/SyncButton";
import { CommandPalette } from "./CommandPalette";
import { usePalette } from "./palette";
import { PullToSearch } from "./PullToSearch";
import { MiniPlayer, MusicHost } from "@/modules/music/MiniPlayer";

const groups: ModuleGroup[] = ["daily", "track", "create"];
const SETTINGS_HUE = "#7d8696";

function useActivePath() {
  return useRouterState({ select: (s) => s.location.pathname });
}

function isActive(current: string, path: string) {
  return path === "/" ? current === "/" : current.startsWith(path);
}

function SidebarLink({
  to,
  icon,
  label,
  hue,
  active,
}: {
  to: string;
  icon: ReactNode;
  label: string;
  hue: string;
  active: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group relative flex h-[34px] items-center gap-3 rounded-[10px] px-2.5 text-[14px] transition-colors duration-200 [&_svg]:size-[18px]",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active ? (
        <motion.span
          layoutId="sidebar-active"
          transition={spring}
          className="absolute inset-0 rounded-[10px] bg-surface shadow-soft ring-1 ring-border/70"
        />
      ) : (
        <span className="absolute inset-0 rounded-[10px] bg-surface/0 transition-colors duration-200 group-hover:bg-surface/55" />
      )}
      <span
        className="relative transition-colors duration-200"
        style={{ color: active ? hue : undefined }}
      >
        {icon}
      </span>
      <span className="relative">{label}</span>
    </Link>
  );
}

function Sidebar() {
  const path = useActivePath();
  const openPalette = usePalette((s) => s.setOpen);
  const lock = useSession((s) => s.lock);
  const mac = navigator.userAgent.includes("Mac");

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[252px] shrink-0 flex-col border-r border-border/80 bg-surface-muted/70 px-3 pt-safe md:flex">
      <div className="flex items-center gap-2.5 px-2 pb-4 pt-5">
        <BrandMark />
        <span className="text-[16px] font-semibold tracking-[-0.02em]">Kaizen</span>
      </div>

      <button
        onClick={() => openPalette(true)}
        className="group mb-5 flex h-9 items-center gap-2.5 rounded-[10px] border border-border bg-surface px-2.5 text-[14px] text-muted-foreground shadow-soft transition-[color,box-shadow] duration-200 hover:text-foreground hover:shadow-float"
      >
        <MagnifyingGlass size={16} />
        <span className="flex-1 text-left">Search</span>
        <Kbd>{mac ? "⌘" : "Ctrl"}</Kbd>
        <Kbd>K</Kbd>
      </button>

      <nav className="-mx-1 flex-1 overflow-y-auto px-1 pb-4" aria-label="Modules">
        {groups.map((group) => (
          <div key={group} className="mb-5">
            <p className="px-2.5 pb-1.5 text-[12px] font-medium text-muted-foreground/75">{groupLabels[group]}</p>
            <div className="grid gap-0.5">
              {modules
                .filter((m) => m.group === group)
                .map((m) => (
                  <SidebarLink
                    key={m.id}
                    to={m.path}
                    icon={<m.icon weight={isActive(path, m.path) ? "duotone" : "regular"} />}
                    label={m.title}
                    hue={m.hue}
                    active={isActive(path, m.path)}
                  />
                ))}
            </div>
          </div>
        ))}
      </nav>

      <MiniPlayer variant="sidebar" />
      <div className="grid gap-0.5 border-t border-border/80 py-3 pb-safe">
        <SidebarLink
          to="/settings"
          icon={<GearSix weight={isActive(path, "/settings") ? "duotone" : "regular"} />}
          label="Settings"
          hue={SETTINGS_HUE}
          active={isActive(path, "/settings")}
        />
        <button
          onClick={() => void lock()}
          className="flex h-[34px] items-center gap-3 rounded-[10px] px-2.5 text-[14px] text-muted-foreground transition-colors hover:bg-surface/55 hover:text-foreground [&_svg]:size-[18px]"
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
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 pt-safe backdrop-blur-xl md:hidden">
      <div className="flex h-13 items-center justify-between px-4">
        <span className="flex items-center gap-2.5">
          <BrandMark className="size-7 rounded-[9px] text-[13px]" />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">Kaizen</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            aria-label="Search"
            onClick={() => openPalette(true)}
            className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-transform active:scale-90 active:bg-surface-muted"
          >
            <MagnifyingGlass size={20} />
          </button>
          <SyncButton variant="icon" />
          <button
            aria-label="Lock"
            onClick={() => void lock()}
            className="grid size-10 place-items-center rounded-xl text-muted-foreground transition-transform active:scale-90 active:bg-surface-muted"
          >
            <Lock size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}

function Indicator({ hue }: { hue: string }) {
  return (
    <motion.span
      layoutId="bottom-nav-indicator"
      transition={spring}
      className="absolute top-2 h-8 w-14 rounded-full"
      style={{ background: `color-mix(in srgb, ${hue} 18%, transparent)` }}
    />
  );
}

function BottomNav() {
  const path = useActivePath();
  const [moreOpen, setMoreOpen] = useState(false);
  const primary = modules.filter((m) => m.mobilePrimary);
  const inMore = !primary.some((m) => isActive(path, m.path));
  const more = [
    ...modules.filter((m) => !m.mobilePrimary),
    { id: "settings", path: "/settings", title: "Settings", icon: GearSix, hue: SETTINGS_HUE },
  ];

  const tabClass =
    "relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-transform active:scale-95";

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border/60 bg-background/85 pb-safe backdrop-blur-xl md:hidden"
      >
        <div className="flex px-2">
          {primary.map((m) => {
            const active = isActive(path, m.path);
            return (
              <Link key={m.id} to={m.path} className={cn(tabClass, active ? "text-foreground" : "text-muted-foreground")}>
                {active ? <Indicator hue={m.hue} /> : null}
                <m.icon size={22} weight={active ? "duotone" : "regular"} className="relative" style={{ color: active ? m.hue : undefined }} />
                <span className="relative">{m.title}</span>
              </Link>
            );
          })}
          <button onClick={() => setMoreOpen(true)} className={cn(tabClass, inMore ? "text-foreground" : "text-muted-foreground")}>
            {inMore ? <Indicator hue="var(--accent)" /> : null}
            <DotsThreeOutline size={22} weight={inMore ? "fill" : "regular"} className="relative" />
            <span className="relative">More</span>
          </button>
        </div>
      </nav>

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogContent>
          <span aria-hidden className="mx-auto -mt-2 h-1 w-10 rounded-full bg-border" />
          <DialogTitle>Everything</DialogTitle>
          <div className="grid grid-cols-3 gap-2.5">
            {more.map((m, i) => {
              const active = isActive(path, m.path);
              return (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease, delay: 0.04 + i * 0.025 }}
                >
                  <Link
                    to={m.path}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex aspect-[5/4] flex-col items-center justify-center gap-2.5 rounded-2xl border text-[13px] font-medium transition-transform active:scale-95",
                      active ? "border-transparent bg-surface shadow-soft" : "border-border/70 bg-surface-muted",
                    )}
                  >
                    <ModuleTile icon={m.icon} hue={m.hue} size="md" />
                    {m.title}
                  </Link>
                </motion.div>
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
  return (
    <div className="flex min-h-[100dvh] pl-safe pr-safe">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar />
        {/* Keyed so each page fades in; pages stagger their own content. */}
        <motion.main
          key={path}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25, ease }}
          className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0"
        >
          <Outlet />
        </motion.main>
      </div>
      <BottomNav />
      <MiniPlayer variant="bar" />
      <MusicHost />
      <SyncButton variant="floating" />
      <CommandPalette />
      <PullToSearch />
    </div>
  );
}
