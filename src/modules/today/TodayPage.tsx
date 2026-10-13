import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";
import { ArrowUpRight, CalendarBlank, HandCoins, Hourglass, Lightbulb, ListChecks, Target } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";

import { ModuleTile, Sky, Wash } from "@/components/visual";
import { rise, stagger } from "@/lib/motion";
import { formatClock, formatDayMonth, formatWeekday, greeting, useNow } from "@/lib/time";
import { cn } from "@/lib/utils";
import { modules } from "@/modules/registry";

const hueOf = (id: string) => modules.find((m) => m.id === id)?.hue ?? "var(--accent)";

function Card({
  to,
  title,
  icon,
  hue,
  className,
  children,
}: {
  to: string;
  title: string;
  icon: Icon;
  hue: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div variants={rise} className={className}>
      <Link
        to={to}
        className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-soft transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-float active:translate-y-0"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-10 -top-16 size-48 rounded-full opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-90"
          style={{ background: `color-mix(in oklch, ${hue} 16%, transparent)` }}
        />
        <div className="relative flex items-center justify-between">
          <span className="flex items-center gap-2.5">
            <ModuleTile icon={icon} hue={hue} size="sm" />
            <span className="text-[14px] font-semibold tracking-tight">{title}</span>
          </span>
          <ArrowUpRight
            size={16}
            className="text-muted-foreground opacity-0 transition-[opacity,transform] duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100"
          />
        </div>
        <div className="relative mt-4 flex flex-1 flex-col">{children}</div>
      </Link>
    </motion.div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="mt-auto text-[14px] leading-relaxed text-muted-foreground">{children}</p>;
}

/** Hours of the college day; classes will sit on this line in Phase 1. */
function DayLine() {
  const hours = [8, 10, 12, 14, 16, 18];
  return (
    <div className="mb-5 mt-1 flex flex-1 flex-col" aria-hidden>
      <div className="relative min-h-28 flex-1 overflow-hidden rounded-xl bg-surface-muted">
        {hours.slice(1, -1).map((h, i) => (
          <span
            key={h}
            className="absolute top-0 h-full w-px bg-border"
            style={{ left: `${((i + 1) / (hours.length - 1)) * 100}%` }}
          />
        ))}
        <span className="absolute inset-0 grid place-items-center text-[13px] font-medium text-muted-foreground">
          No classes yet
        </span>
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-muted-foreground">
        {hours.map((h) => (
          <span key={h}>{String(h).padStart(2, "0")}</span>
        ))}
      </div>
    </div>
  );
}

function Ring({ hue }: { hue: string }) {
  return (
    <svg viewBox="0 0 44 44" className="mb-4 size-16 -rotate-90" aria-hidden>
      <circle cx="22" cy="22" r="18" fill="none" stroke="var(--surface-muted)" strokeWidth="6" />
      {/* Faint dashed ring until there are habits to fill it. */}
      <circle
        cx="22"
        cy="22"
        r="18"
        fill="none"
        stroke={hue}
        strokeOpacity="0.35"
        strokeWidth="1.5"
        strokeDasharray="2 4"
      />
    </svg>
  );
}

export function TodayPage() {
  const now = useNow(1000);

  return (
    <div className="relative">
      <Wash hue={hueOf("today")} />
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className="relative mx-auto grid w-full max-w-[1080px] gap-4 px-4 py-5 md:px-10 md:py-10"
      >
        <motion.div variants={rise}>
          <Sky className="min-h-[220px] rounded-3xl shadow-float md:min-h-[260px]">
            <div className="flex h-full min-h-[220px] flex-col justify-between p-6 text-white md:min-h-[260px] md:p-8">
              <p className="text-[15px] font-medium text-white/85">{greeting(now)}</p>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-[40px] font-semibold leading-none tracking-[-0.035em] md:text-[56px]">
                    {formatWeekday(now)}
                  </p>
                  <p className="mt-2 text-[17px] font-medium text-white/85 md:text-[19px]">{formatDayMonth(now)}</p>
                </div>
                <p className="text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-white/90 md:text-[30px]">
                  {formatClock(now)}
                </p>
              </div>
            </div>
          </Sky>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-6">
          <Card to="/calendar" title="Classes today" icon={CalendarBlank} hue={hueOf("calendar")} className="md:col-span-4 md:row-span-2">
            <DayLine />
            <Empty>Add your weekly timetable and today's classes appear here, ready to mark attendance in one tap.</Empty>
          </Card>
          <Card to="/habits" title="Habits" icon={Target} hue={hueOf("habits")} className="md:col-span-2">
            <Ring hue={hueOf("habits")} />
            <Empty>Your daily habits and streaks.</Empty>
          </Card>
          <Card to="/practice" title="Up next" icon={Hourglass} hue={hueOf("practice")} className="md:col-span-2">
            <Empty>Contests, matches and important dates coming up.</Empty>
          </Card>
          <Card to="/lists" title="Tasks" icon={ListChecks} hue={hueOf("lists")} className="md:col-span-3">
            <Empty>Today's tasks, written the way you think: "submit OS assignment friday 5pm".</Empty>
          </Card>
          <Card to="/debts" title="Debts" icon={HandCoins} hue={hueOf("debts")} className="md:col-span-3">
            <Empty>Who owes you, whom you owe, and anything due soon.</Empty>
          </Card>
          <Card to="/ideas" title="From your scrapbook" icon={Lightbulb} hue={hueOf("ideas")} className="md:col-span-6">
            <Empty>A random idea from your scrapbook resurfaces here each day.</Empty>
          </Card>
        </div>

        <motion.p variants={rise} className={cn("pt-2 text-center text-[13px] text-muted-foreground")}>
          Phase 1 fills this page with your day.
        </motion.p>
      </motion.div>
    </div>
  );
}
