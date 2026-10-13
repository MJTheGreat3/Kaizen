import type { Icon } from "@phosphor-icons/react";
import {
  Barbell,
  CalendarDots,
  Code,
  GridFour,
  Lightbulb,
  ListChecks,
  Scribble,
  SunHorizon,
  Target,
  Tree,
  Wallet,
} from "@phosphor-icons/react";

export type ModuleGroup = "daily" | "track" | "create";

export interface ModuleDef {
  id: string;
  path: string;
  title: string;
  icon: Icon;
  group: ModuleGroup;
  /** One line shown in the sidebar tooltip and on the placeholder page. */
  summary: string;
  /** What the module will do once built. */
  planned: string[];
  /** Roadmap phase from PLAN.md. */
  phase: number;
  /** Shown in the Android bottom bar (max 4; the rest live under "More"). */
  mobilePrimary?: boolean;
}

export const modules: ModuleDef[] = [
  {
    id: "today",
    path: "/",
    title: "Today",
    icon: SunHorizon,
    group: "daily",
    summary: "Everything that matters today, in one place.",
    planned: [
      "Today's classes, tasks and habits",
      "Upcoming contests and important dates",
      "This month's spending and a random idea",
    ],
    phase: 1,
    mobilePrimary: true,
  },
  {
    id: "lists",
    path: "/lists",
    title: "Lists",
    icon: ListChecks,
    group: "daily",
    summary: "To-do, to-watch and to-read, with natural language input.",
    planned: [
      "Type \"submit OS assignment friday 5pm #college\" and it just works",
      "Recurring tasks, snooze, reminders",
      "Reading progress and ratings",
    ],
    phase: 1,
    mobilePrimary: true,
  },
  {
    id: "habits",
    path: "/habits",
    title: "Habits",
    icon: Target,
    group: "daily",
    summary: "Habits, streaks and longer goals.",
    planned: ["Daily, weekly or quantity targets", "Smart reminders", "Goals that track other modules"],
    phase: 1,
  },
  {
    id: "calendar",
    path: "/calendar",
    title: "Calendar",
    icon: CalendarDots,
    group: "daily",
    summary: "College timetable, attendance and important dates.",
    planned: [
      "Weekly timetable with class reminders",
      "Attendance per subject against your target",
      "Birthdays, deadlines and countdowns",
    ],
    phase: 1,
  },
  {
    id: "focus",
    path: "/focus",
    title: "Focus",
    icon: Tree,
    group: "daily",
    summary: "Grow a tree while you stay focused.",
    planned: ["Pomodoro or custom sessions", "Strict mode on Android", "Your forest, day by day"],
    phase: 3,
    mobilePrimary: true,
  },
  {
    id: "activity",
    path: "/activity",
    title: "Activity",
    icon: GridFour,
    group: "track",
    summary: "Colour-coded heatmap and streaks across everything.",
    planned: ["One colour per activity", "Filters by type, range and tag", "Streaks with rest days and freezes"],
    phase: 3,
    mobilePrimary: true,
  },
  {
    id: "practice",
    path: "/practice",
    title: "Practice",
    icon: Code,
    group: "track",
    summary: "Codeforces and LeetCode progress.",
    planned: ["Rating graphs and solved counts", "Weak-topic analysis", "Revisit queue and contest reminders"],
    phase: 4,
  },
  {
    id: "fitness",
    path: "/fitness",
    title: "Fitness",
    icon: Barbell,
    group: "track",
    summary: "Gym workouts, sports sessions and body metrics.",
    planned: ["Live workout logging with rest timer", "PRs and progressive overload", "Sports sessions and body metrics"],
    phase: 5,
  },
  {
    id: "finance",
    path: "/finance",
    title: "Finance",
    icon: Wallet,
    group: "track",
    summary: "Monthly statements, categories and insights.",
    planned: ["CSV statement import per bank", "Auto-categorisation that learns", "Budgets and recurring payments"],
    phase: 6,
  },
  {
    id: "ideas",
    path: "/ideas",
    title: "Ideas",
    icon: Lightbulb,
    group: "create",
    summary: "A scrapbook for ideas with no deadlines.",
    planned: ["Capture in under five seconds", "Text, links, images and voice", "Resurface an old idea now and then"],
    phase: 1,
  },
  {
    id: "canvas",
    path: "/canvas",
    title: "Canvas",
    icon: Scribble,
    group: "create",
    summary: "An infinite whiteboard.",
    planned: ["Freehand drawing and shapes", "Pen support on the phone", "Export to PNG and SVG"],
    phase: 7,
  },
];

export const groupLabels: Record<ModuleGroup, string> = {
  daily: "Daily",
  track: "Track",
  create: "Create",
};
