import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

import { App } from "./App";
import { ErrorBoundary } from "@/core/shell/ErrorBoundary";
import { log } from "@/lib/log";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: false },
  },
});

// Lets the browser preview refresh data after editing its mock database.
if (import.meta.env.DEV) (window as unknown as { __queryClient: QueryClient }).__queryClient = queryClient;

window.addEventListener("error", (e) => log.error(`window error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log.error(`unhandled rejection: ${String(e.reason?.message ?? e.reason)}`));

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
