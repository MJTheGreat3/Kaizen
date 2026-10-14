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

export const router = createRouter({
  routeTree: rootRoute.addChildren([...moduleRoutes, settingsRoute]),
  // Hash history works the same under the dev server and the bundled app.
  history: createHashHistory(),
  defaultPreload: false,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
