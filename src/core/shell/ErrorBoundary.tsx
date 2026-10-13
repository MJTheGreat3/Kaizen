import { Component, type ErrorInfo, type ReactNode } from "react";

import { log } from "@/lib/log";

interface State {
  error: Error | null;
  copied: boolean;
}

/** Last-resort screen for render errors, with details that can be copied. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error(`render error: ${error.message}\n${info.componentStack ?? ""}`);
  }

  private details() {
    const { error } = this.state;
    return `${error?.name}: ${error?.message}\n\n${error?.stack ?? ""}\n\n${navigator.userAgent}`;
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 pt-safe pb-safe text-foreground">
        <div className="w-full max-w-[460px]">
          <h1 className="text-[22px] font-semibold tracking-tight">Something broke</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            Your data is safe. Reload to continue, and copy the details if this keeps happening.
          </p>
          <pre className="mt-6 max-h-56 overflow-auto rounded-xl border border-border bg-surface p-4 font-mono text-[12px] leading-relaxed text-muted-foreground">
            {this.state.error.message}
          </pre>
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground"
            >
              Reload
            </button>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(this.details());
                this.setState({ copied: true });
              }}
              className="h-10 rounded-lg border border-border bg-surface px-4 text-sm font-medium"
            >
              {this.state.copied ? "Copied" : "Copy error details"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
