import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarCheck, CalendarDots, CalendarHeart, GearSix, GraduationCap } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { Segmented, Skeleton } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/kit";
import { Page, PageHeader } from "@/core/shell/PageHeader";
import { useOpenRequest } from "@/core/shell/openRequest";
import { relativeDay } from "@/lib/dates";
import { rise } from "@/lib/motion";
import { modules } from "@/modules/registry";
import { AttendanceView } from "./AttendanceView";
import { useCalendar } from "./data";
import { DatesView } from "./DatesView";
import { SemesterDialog } from "./dialogs";
import { TimetableView } from "./TimetableView";

const mod = modules.find((m) => m.id === "calendar")!;
const HUE = mod.hue;

type Tab = "timetable" | "attendance" | "dates";

const tabFor = (module: string | undefined): Tab | null => (module === "dates" ? "dates" : module === "subjects" ? "timetable" : null);

export function CalendarPage() {
  const { data, isLoading } = useCalendar();
  const [tab, setTab] = useState<Tab>(() => tabFor(useOpenRequest.getState().target?.module) ?? "timetable");
  const [semesterOpen, setSemesterOpen] = useState(false);
  const semester = data?.semester ?? null;

  // Switch to the tab that can open a search result; that view takes the request.
  useEffect(
    () =>
      useOpenRequest.subscribe((s) => {
        const next = tabFor(s.target?.module);
        if (next) setTab(next);
      }),
    [],
  );

  return (
    <Page hue={HUE} className="max-w-[1100px]">
      <PageHeader
        title="Calendar"
        description={semester ? `${semester.name}, ${relativeDay(semester.startDate)} to ${relativeDay(semester.endDate)}` : "Timetable, attendance and important dates."}
        icon={mod.icon}
        hue={HUE}
        actions={
          semester ? (
            <Button variant="secondary" size="sm" onClick={() => setSemesterOpen(true)}>
              <GearSix />
              Semester
            </Button>
          ) : null
        }
      />

      <motion.div variants={rise} className="mt-8">
        <Segmented<Tab>
          label="View"
          value={tab}
          onChange={setTab}
          className="w-full sm:w-auto"
          options={[
            { value: "timetable", label: "Timetable", icon: <CalendarDots /> },
            { value: "attendance", label: "Attendance", icon: <CalendarCheck /> },
            { value: "dates", label: "Dates", icon: <CalendarHeart /> },
          ]}
        />
      </motion.div>

      <motion.div variants={rise} className="mt-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }}>
            {tab === "dates" ? (
              <DatesView />
            ) : isLoading ? (
              <Skeleton className="h-80 rounded-2xl" />
            ) : !semester ? (
              <div className="rounded-2xl border border-border bg-surface shadow-soft">
                <EmptyState
                  icon={GraduationCap}
                  hue={HUE}
                  title="Set up your semester"
                  action={<Button onClick={() => setSemesterOpen(true)}>Start a semester</Button>}
                >
                  Add the semester dates and your 80% attendance target, then your subjects and weekly timetable.
                </EmptyState>
              </div>
            ) : tab === "timetable" ? (
              <TimetableView data={data!} />
            ) : (
              <AttendanceView data={data!} />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <SemesterDialog key={`${semester?.id ?? "new"}-${semesterOpen}`} semester={semester} open={semesterOpen} onClose={() => setSemesterOpen(false)} />
    </Page>
  );
}
