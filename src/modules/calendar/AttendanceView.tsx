import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { CheckCircle as CheckIcon, Checks, Warning } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionTitle } from "@/components/ui/kit";
import { ProgressRing } from "@/components/ui/ring";
import type { Subject } from "@/core/db/schema";
import { relativeDay, todayKey } from "@/lib/dates";
import { ease } from "@/lib/motion";
import { componentLabel, occurrencesBetween, subjectStats, type ComponentStats, type Occurrence } from "./attendance";
import { ClassList } from "./ClassList";
import { useMarkMany, type CalendarData } from "./data";

function tone(s: ComponentStats) {
  if (s.percent === null) return "var(--muted-foreground)";
  if (s.percent >= s.target) return "#3fa66b";
  if (s.percent >= s.target - 5) return "#d4a02c";
  return "#e05a5a";
}

function advice(s: ComponentStats): string {
  if (s.held === 0) return s.remaining ? `${s.remaining} classes this semester` : "No classes yet";
  if (s.mustAttend > 0) {
    const reachable = s.mustAttend <= s.remaining;
    return reachable
      ? `Attend the next ${s.mustAttend} to get back to ${s.target}%`
      : `Can't reach ${s.target}% this semester; best possible ${Math.floor(s.bestFinal ?? 0)}%`;
  }
  if (s.canSkip === 0) return `Right at the line. Don't miss the next one`;
  return `You can miss ${s.canSkip} ${s.canSkip === 1 ? "class" : "classes"} and stay above ${s.target}%`;
}

function SubjectCard({ subject, stats, onOpen, index }: { subject: Subject; stats: ComponentStats[]; onOpen: () => void; index: number }) {
  const main = stats[0];
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease, delay: index * 0.05 }}
      onClick={onOpen}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 text-left shadow-soft transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-float"
    >
      <div className="flex items-center gap-4">
        <ProgressRing value={(main?.percent ?? 0) / 100} hue={main ? tone(main) : "var(--input)"} size={60} stroke={6}>
          <span className="text-[13px] font-semibold tabular-nums">{main?.percent === null || !main ? "–" : `${Math.round(main.percent)}%`}</span>
        </ProgressRing>
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-[16px] font-semibold tracking-tight">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: subject.color }} />
            {subject.name}
          </p>
          {main ? <p className="mt-0.5 text-[13px] text-muted-foreground">{advice(main)}</p> : null}
        </div>
      </div>
      <div className="grid gap-1.5">
        {stats.map((s) => (
          <div key={s.component} className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">{componentLabel[s.component]}</span>
            <span className="tabular-nums">
              <span className="font-semibold" style={{ color: tone(s) }}>
                {s.attended}/{s.held}
              </span>
              {s.unmarked ? <span className="text-muted-foreground"> · {s.unmarked} unmarked</span> : null}
            </span>
          </div>
        ))}
        {stats.length > 1
          ? stats.slice(1).map((s) => (
              <p key={`a-${s.component}`} className="text-[12px] text-muted-foreground">
                {componentLabel[s.component]}: {advice(s).charAt(0).toLowerCase() + advice(s).slice(1)}
              </p>
            ))
          : null}
      </div>
    </motion.button>
  );
}

export function AttendanceView({ data }: { data: CalendarData }) {
  const semester = data.semester!;
  const today = todayKey();
  const now = new Date();
  const nowInfo = { day: today, minutes: now.getHours() * 60 + now.getMinutes() };
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const markMany = useMarkMany();

  const all = useMemo(() => occurrencesBetween(semester, data.slots, data.exceptions, semester.startDate, semester.endDate), [semester, data.slots, data.exceptions]);
  const marks = useMemo(() => new Map(data.marks.map((m) => [m.classKey, m.status])), [data.marks]);
  const isPast = (o: Occurrence) => o.date < today || (o.date === today && o.endMin <= nowInfo.minutes);
  const unmarked = all.filter((o) => !o.cancelled && isPast(o) && !marks.has(o.key)).reverse();
  const stats = data.subjects.map((s) => ({ subject: s, stats: subjectStats(s, semester, all, data.marks, nowInfo) }));
  const totalAttended = stats.reduce((n, s) => n + s.stats.reduce((m, c) => m + c.attended, 0), 0);
  const totalHeld = stats.reduce((n, s) => n + s.stats.reduce((m, c) => m + c.held, 0), 0);
  const atRisk = stats.filter((s) => s.stats.some((c) => c.percent !== null && c.percent < c.target)).length;
  const openSubject = data.subjects.find((s) => s.id === subjectId) ?? null;

  if (!data.slots.length && !data.exceptions.some((e) => e.kind === "extra")) {
    return (
      <div className="rounded-2xl border border-border bg-surface shadow-soft">
        <EmptyState icon={CheckIcon} hue="#3fa66b" title="Nothing to track yet">
          Add classes to your timetable and attendance appears here automatically.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <ProgressRing value={totalHeld ? totalAttended / totalHeld : 0} hue={totalHeld && (totalAttended / totalHeld) * 100 >= semester.target ? "#3fa66b" : "#e05a5a"} size={72} stroke={7}>
          <span className="text-[15px] font-semibold tabular-nums">{totalHeld ? `${Math.round((totalAttended / totalHeld) * 100)}%` : "–"}</span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-semibold tracking-tight">
            {totalAttended} of {totalHeld} classes attended
          </p>
          <p className="text-[14px] text-muted-foreground">
            Target {semester.target}%{atRisk ? `, ${atRisk} ${atRisk === 1 ? "subject" : "subjects"} below it` : ", every subject on track"}
          </p>
        </div>
        {atRisk ? <Warning size={24} weight="fill" className="text-[#e05a5a]" /> : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {stats.map(({ subject, stats }, i) => (
          <SubjectCard key={subject.id} subject={subject} stats={stats} index={i} onOpen={() => setSubjectId(subject.id)} />
        ))}
      </div>

      {unmarked.length ? (
        <section>
          <SectionTitle
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={markMany.isPending}
                onClick={() => markMany.mutate({ occs: unmarked, semesterId: semester.id, status: "present" })}
              >
                <Checks />
                Mark all present
              </Button>
            }
          >
            Needs marking ({unmarked.length})
          </SectionTitle>
          <div className="grid gap-5">
            {[...new Set(unmarked.slice(0, 40).map((o) => o.date))].map((day) => (
              <div key={day}>
                <p className="mb-2 text-[13px] font-medium text-muted-foreground">{relativeDay(day)}</p>
                <ClassList occurrences={unmarked.filter((o) => o.date === day).reverse()} subjects={data.subjects} marks={marks} semester={semester} now={nowInfo} />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog open={!!openSubject} onOpenChange={(o) => !o && setSubjectId(null)}>
        <DialogContent className="md:max-w-xl">
          {openSubject ? (
            <>
              <DialogHeader>
                <DialogTitle>{openSubject.name}</DialogTitle>
                <DialogDescription>Every class so far. Change any mark here.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4">
                {(() => {
                  const past = all.filter((o) => o.subjectId === openSubject.id && isPast(o)).reverse();
                  if (!past.length) return <p className="text-[14px] text-muted-foreground">No classes held yet.</p>;
                  return [...new Set(past.map((o) => o.date))].map((day) => (
                    <div key={day}>
                      <p className="mb-2 text-[13px] font-medium text-muted-foreground">{relativeDay(day)}</p>
                      <ClassList occurrences={past.filter((o) => o.date === day).reverse()} subjects={data.subjects} marks={marks} semester={semester} now={nowInfo} compact />
                    </div>
                  ));
                })()}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
