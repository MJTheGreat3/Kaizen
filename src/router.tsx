import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { AppShell } from "@/core/shell/AppShell";
import { Placeholder } from "@/modules/Placeholder";
import { modules } from "@/modules/registry";
import { SettingsPage } from "@/modules/settings/SettingsPage";

const rootRoute = createRootRoute({ component: AppShell });

const moduleRoutes = modules.map((module) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path: module.path,
    component: () => <Placeholder module={module} />,
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
