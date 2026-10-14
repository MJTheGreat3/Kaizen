import type { Icon } from "@phosphor-icons/react";
import {
  Barbell,
  Basketball,
  CalendarDots,
  Flag,
  Code,
  GridFour,
  HandCoins,
  Lightbulb,
  ListChecks,
  MusicNotes,
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
  /** Module colour: icon tiles, page wash and active navigation. */
  hue: string;
  /** Shown in the Android bottom bar (max 4; the rest live under "More"). */
  mobilePrimary?: boolean;
}

export const modules: ModuleDef[] = [
  {
    id: "today",
    hue: "#f0a03c",
    path: "/",
    title: "Today",
    icon: SunHorizon,
    group: "daily",
    summary: "Everything that matters today, in one place.",
    planned: [
      "Today's classes, tasks and habits",
      "Upcoming contests, matches and important dates",
      "Debts due and a random idea",
    ],
    phase: 1,
    mobilePrimary: true,
  },
  {
    id: "lists",
    hue: "#5b6ee1",
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
    hue: "#8e6bd8",
    path: "/habits",
    title: "Habits",
    icon: Target,
    group: "daily",
    summary: "Daily, weekly and counted habits with streaks.",
    planned: ["Daily, weekly or quantity targets", "Smart reminders", "Goals that track other modules"],
    phase: 1,
  },
  {
    id: "calendar",
    hue: "#d9608f",
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
    hue: "#2fa5a0",
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
    id: "debts",
    hue: "#c2843d",
    path: "/debts",
    title: "Debts",
    icon: HandCoins,
    group: "daily",
    summary: "Who owes you, whom you owe, when and why.",
    planned: [
      "Record an IOU in seconds: \"Rahul owes 250 for pizza\"",
      "Net balance per person, partial repayments",
      "Bill splitting and due-date reminders",
    ],
    phase: 1,
  },
  {
    id: "activity",
    hue: "#e05a5a",
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
    id: "goals",
    hue: "#1f9bd1",
    path: "/goals",
    title: "Goals",
    icon: Flag,
    group: "track",
    summary: "Longer targets that fill themselves from other modules.",
    planned: ["Numbers you log, activity totals, habits or tasks", "Pace against a finish date", "Promote an idea into a goal"],
    phase: 3,
  },
  {
    id: "practice",
    hue: "#3fa66b",
    path: "/practice",
    title: "Practice",
    icon: Code,
    group: "track",
    summary: "Codeforces, LeetCode, AtCoder, CodeChef and GitHub progress.",
    planned: ["Rating graphs and solved counts", "Weak-topic analysis", "Revisit queue and contest reminders"],
    phase: 4,
  },
  {
    id: "fitness",
    hue: "#e8673a",
    path: "/fitness",
    title: "Gym",
    icon: Barbell,
    group: "track",
    summary: "Workouts, routines, personal records and body metrics.",
    planned: ["Live workout logging with rest timer", "Records and progress per exercise", "Weight, measurements and progress photos"],
    phase: 5,
  },
  {
    id: "sports",
    hue: "#3d8bd9",
    path: "/sports",
    title: "Sports",
    icon: Basketball,
    group: "track",
    summary: "Your sessions, NBA, football and cricket teams, and favourite players.",
    planned: [
      "Log sessions for the heatmap",
      "Follow teams: fixtures and results",
      "Favourite players with season and career stats",
    ],
    phase: 5,
  },
  {
    id: "finance",
    hue: "#a3b13b",
    path: "/finance",
    title: "Finance",
    icon: Wallet,
    group: "track",
    summary: "Monthly statements, categories and insights.",
    planned: ["CSV statement import per bank", "Auto-categorisation that learns", "Budgets and recurring payments"],
    phase: 9,
  },
  {
    id: "ideas",
    hue: "#d4b62c",
    path: "/ideas",
    title: "Ideas",
    icon: Lightbulb,
    group: "create",
    summary: "A scrapbook for ideas with no deadlines.",
    planned: ["Capture in under five seconds", "Text, links, images and voice", "Resurface an old idea now and then"],
    phase: 1,
  },
  {
    id: "music",
    hue: "#c94fd6",
    path: "/music",
    title: "Music",
    icon: MusicNotes,
    group: "create",
    summary: "Your Spotify, with listening stats.",
    planned: [
      "Play playlists and songs on any Spotify device",
      "Top artists, tracks and albums",
      "Your own listening history, kept locally",
    ],
    phase: 7,
  },
  {
    id: "canvas",
    hue: "#7487a3",
    path: "/canvas",
    title: "Canvas",
    icon: Scribble,
    group: "create",
    summary: "Whiteboards to sketch, plan and think on.",
    planned: ["Freehand drawing, shapes, text and images", "Pen and touch on the phone", "Boards from ideas, export to PNG and SVG"],
    phase: 6,
  },
];

export const groupLabels: Record<ModuleGroup, string> = {
  daily: "Daily",
  track: "Track",
  create: "Create and play",
};

/** A module's route, typed as a plain string since routes are built from this list. */
export const pathOf = (id: string): string => modules.find((m) => m.id === id)?.path ?? "/";
