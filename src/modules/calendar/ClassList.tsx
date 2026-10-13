import { motion } from "motion/react";
import { ArrowCounterClockwise, Check, FirstAid, MapPin, Prohibit, X } from "@phosphor-icons/react";

import { RowMenu } from "@/components/ui/kit";
import type { AttendanceStatus, Semester, Subject } from "@/core/db/schema";
import { formatMinutes } from "@/lib/dates";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { Occurrence } from "./attendance";
import { useCancelClass, useDeleteException, useMarkClass } from "./data";
import { KIND_LABEL } from "./labels";
import { STATUS_COLOR } from "./labels";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; icon: typeof Check }[] = [
  { value: "present", label: "Present", icon: Check },
  { value: "absent", label: "Absent", icon: X },
  { value: "excused", label: "Excused (counts as present)", icon: FirstAid },
];

function MarkButtons({ status, onMark, subjectName }: { status: AttendanceStatus | undefined; onMark: (s: AttendanceStatus | null) => void; subjectName: string }) {
  return (
    <div role="radiogroup" aria-label={`Attendance for ${subjectName}`} className="flex gap-1">
      {STATUS_OPTIONS.map((o) => {
        const active = status === o.value;
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            title={o.label}
            whileTap={{ scale: 0.88 }}
            onClick={(e) => {
              e.stopPropagation();
              onMark(active ? null : o.value);
            }}
            className="grid size-9 place-items-center rounded-full transition-colors"
            style={{
              background: active ? STATUS_COLOR[o.value] : "var(--surface-muted)",
              color: active ? "white" : "var(--muted-foreground)",
            }}
          >
            <o.icon size={17} weight="bold" />
          </motion.button>
        );
      })}
    </div>
  );
}

export function ClassList({
  occurrences,
  subjects,
  marks,
  semester,
  now,
  compact,
}: {
  occurrences: Occurrence[];
  subjects: Subject[];
  marks: Map<string, AttendanceStatus>;
  semester: Semester;
  now: { day: string; minutes: number };
  compact?: boolean;
}) {
  const mark = useMarkClass();
  const cancel = useCancelClass();
  const restore = useDeleteException();
  const byId = new Map(subjects.map((s) => [s.id, s]));

  return (
    <ul className="grid gap-2">
      {occurrences.map((o, i) => {
        const subject = byId.get(o.subjectId);
        if (!subject) return null;
        const started = o.date < now.day || (o.date === now.day && o.startMin <= now.minutes);
        const live = o.date === now.day && o.startMin <= now.minutes && now.minutes < o.endMin;
        const status = marks.get(o.key);
        return (
          <motion.li
            key={o.key}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease, delay: i * 0.04 }}
            className={cn(
              "relative flex flex-wrap items-center gap-x-3 gap-y-2 overflow-hidden rounded-xl border border-border bg-surface py-3 pl-4 pr-2 sm:flex-nowrap",
              o.cancelled && "opacity-60",
            )}
          >
            <span aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ background: subject.color }} />
            <div className={cn("w-16 shrink-0 text-[13px] tabular-nums", compact && "w-14")}>
              <p className="font-semibold">{formatMinutes(o.startMin)}</p>
              <p className="text-muted-foreground">{formatMinutes(o.endMin)}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-[15px] font-medium", o.cancelled && "line-through")}>{subject.name}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
                <span>{KIND_LABEL[o.kind]}</span>
                {o.room ? (
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin size={12} />
                    {o.room}
                  </span>
                ) : null}
                {o.extraId ? <span className="font-medium" style={{ color: subject.color }}>Extra class</span> : null}
                {o.cancelled ? <span className="font-medium text-danger">Cancelled</span> : null}
                {live ? <span className="font-medium text-success">Now</span> : null}
              </p>
            </div>
            {!o.cancelled && started ? (
              // Own line on phones so subject names have room.
              <div className="order-last flex w-full justify-end sm:order-none sm:w-auto">
                <MarkButtons status={status} subjectName={subject.name} onMark={(s) => mark.mutate({ occ: o, semesterId: semester.id, status: s })} />
              </div>
            ) : null}
            <RowMenu
              items={
                o.cancelled
                  ? [{ label: "Restore class", icon: ArrowCounterClockwise, onSelect: () => o.cancelId && restore.mutate(o.cancelId) }]
                  : [{ label: o.extraId ? "Remove extra class" : "Cancel this class", icon: Prohibit, danger: true, onSelect: () => cancel.mutate({ occ: o, semesterId: semester.id }) }]
              }
            />
          </motion.li>
        );
      })}
    </ul>
  );
}
