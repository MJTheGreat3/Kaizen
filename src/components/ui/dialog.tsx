import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  hideClose,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { hideClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 dark:bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          // Centred card on desktop; bottom sheet on phones.
          "fixed z-50 grid max-h-[88dvh] gap-5 overflow-y-auto border border-border bg-surface p-6 shadow-float duration-200 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          "inset-x-0 bottom-0 rounded-t-[28px] border-x-0 border-b-0 pb-[calc(1.5rem+env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom-10 data-[state=closed]:slide-out-to-bottom-10",
          "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[calc(100%-2rem)] md:max-w-lg md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border-x md:border-b md:pb-6 md:data-[state=open]:slide-in-from-bottom-0 md:data-[state=open]:zoom-in-[0.97] md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=closed]:zoom-out-[0.97]",
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid gap-1.5 pr-8", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold tracking-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}
