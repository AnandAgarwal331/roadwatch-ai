"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "warning" | "destructive";

interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  toast: (message: Omit<ToastMessage, "id" | "variant"> & { variant?: ToastVariant }) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastVariant, typeof Info> = {
  default: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
};

const STYLES: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-success/30",
  warning: "border-warning/30",
  destructive: "border-destructive/30",
};

const ICON_STYLES: Record<ToastVariant, string> = {
  default: "text-primary",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = React.useState<ToastMessage[]>([]);
  const nextId = React.useRef(0);

  const push = React.useCallback(
    (message: Omit<ToastMessage, "id" | "variant"> & { variant?: ToastVariant }) => {
      nextId.current += 1;
      setMessages((current) => [
        // Cap the stack so a burst of failures cannot bury the screen.
        ...current.slice(-2),
        { id: nextId.current, variant: "default", ...message },
      ]);
    },
    [],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast: push,
      success: (title, description) => push({ title, description, variant: "success" }),
      error: (title, description) => push({ title, description, variant: "destructive" }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      <ToastPrimitive.Provider swipeDirection="right" duration={5200}>
        {children}
        {messages.map((message) => {
          const Icon = ICONS[message.variant];
          return (
            <ToastPrimitive.Root
              key={message.id}
              onOpenChange={(open) => {
                if (!open) setMessages((current) => current.filter((item) => item.id !== message.id));
              }}
              className={cn(
                "flex items-start gap-3 rounded-lg border bg-card p-4 shadow-panel",
                "data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full",
                "data-[state=closed]:animate-out data-[state=closed]:fade-out-80",
                STYLES[message.variant],
              )}
            >
              <Icon className={cn("mt-0.5 h-[18px] w-[18px] shrink-0", ICON_STYLES[message.variant])} />
              <div className="min-w-0 flex-1">
                <ToastPrimitive.Title className="text-sm font-medium leading-snug">
                  {message.title}
                </ToastPrimitive.Title>
                {message.description ? (
                  <ToastPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                    {message.description}
                  </ToastPrimitive.Description>
                ) : null}
              </div>
              <ToastPrimitive.Close
                className="rounded-md p-1 text-muted-foreground transition hover:bg-muted"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </ToastPrimitive.Close>
            </ToastPrimitive.Root>
          );
        })}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
