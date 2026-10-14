import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { AppShell } from "@/core/shell/AppShell";
import { Placeholder } from "@/modules/Placeholder";
import { modules } from "@/modules/registry";
import { SettingsPage } from "@/modules/settings/SettingsPage";
import { TodayPage } from "@/modules/today/TodayPage";
import { ListsPage } from "@/modules/lists/ListsPage";
import { DebtsPage } from "@/modules/debts/DebtsPage";
import { IdeasPage } from "@/modules/ideas/IdeasPage";
import { HabitsPage } from "@/modules/habits/HabitsPage";
import { CalendarPage } from "@/modules/calendar/CalendarPage";
import { FocusPage } from "@/modules/focus/FocusPage";
import { ActivityPage } from "@/modules/activity/ActivityPage";
import { GoalsPage } from "@/modules/goals/GoalsPage";
import { PracticePage } from "@/modules/practice/PracticePage";
import { PlayersPage } from "@/modules/sports/PlayersPage";
import { SportsPage } from "@/modules/sports/SportsPage";
import { BodyPage } from "@/modules/fitness/BodyPage";
import { ExercisesPage } from "@/modules/fitness/ExercisesPage";
import { GymPage } from "@/modules/fitness/GymPage";
import { WorkoutPage } from "@/modules/fitness/WorkoutPage";
import { BoardPage } from "@/modules/canvas/BoardPage";
import { CanvasPage } from "@/modules/canvas/CanvasPage";

/** Built modules; the rest show their placeholder. */
const pages: Record<string, () => React.ReactNode> = {
  today: TodayPage,
  lists: ListsPage,
  debts: DebtsPage,
  ideas: IdeasPage,
  habits: HabitsPage,
  calendar: CalendarPage,
  focus: FocusPage,
  activity: ActivityPage,
  goals: GoalsPage,
  practice: PracticePage,
  sports: SportsPage,
  fitness: GymPage,
  canvas: CanvasPage,
};

const rootRoute = createRootRoute({ component: AppShell });

const moduleRoutes = modules.map((module) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: module.path,
    component: pages[module.id] ?? (() => <Placeholder module={module} />),
  }),
);

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

/** Favourite players' stats, opened from the Sports showcase. */
const playersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sports/players",
  validateSearch: (search: Record<string, unknown>): { p?: string } => ({ p: typeof search.p === "string" ? search.p : undefined }),
  component: PlayersPage,
});

/** A workout being logged, or a finished one. */
const workoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fitness/workout",
  validateSearch: (search: Record<string, unknown>): { w?: string } => ({ w: typeof search.w === "string" ? search.w : undefined }),
  component: WorkoutPage,
});

/** The exercise library, or one exercise (`e`). */
const exercisesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fitness/exercises",
  validateSearch: (search: Record<string, unknown>): { e?: string } => ({ e: typeof search.e === "string" ? search.e : undefined }),
  component: ExercisesPage,
});

const bodyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/fitness/body",
  component: BodyPage,
});

/** One whiteboard (`b`), full screen. */
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/canvas/board",
  validateSearch: (search: Record<string, unknown>): { b?: string } => ({ b: typeof search.b === "string" ? search.b : undefined }),
  component: BoardPage,
});

export const router = createRouter({
  routeTree: rootRoute.addChildren([...moduleRoutes, playersRoute, workoutRoute, exercisesRoute, bodyRoute, boardRoute, settingsRoute]),
  // Hash history works the same under the dev server and the bundled app.
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
