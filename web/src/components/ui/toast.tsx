"use client";

import { X } from "@/components/ui/icons";
import * as React from "react";

import { cn } from "@/lib/utils";

type ToastProviderValue = {
  duration: number;
  label: string;
  swipeDirection: "up" | "right" | "down" | "left";
  swipeThreshold: number;
};

const ToastProviderContext = React.createContext<ToastProviderValue>({
  duration: 5_000,
  label: "Notifications",
  swipeDirection: "right",
  swipeThreshold: 50,
});

interface ToastProviderProps {
  children?: React.ReactNode;
  duration?: number;
  label?: string;
  swipeDirection?: ToastProviderValue["swipeDirection"];
  swipeThreshold?: number;
}

function ToastProvider({
  children,
  duration = 5_000,
  label = "Notifications",
  swipeDirection = "right",
  swipeThreshold = 50,
}: ToastProviderProps) {
  const value = React.useMemo(
    () => ({ duration, label, swipeDirection, swipeThreshold }),
    [duration, label, swipeDirection, swipeThreshold],
  );
  return <ToastProviderContext.Provider value={value}>{children}</ToastProviderContext.Provider>;
}

const ToastViewport = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const provider = React.useContext(ToastProviderContext);
    return (
      <div
        ref={ref}
        role="region"
        aria-label={props["aria-label"] ?? provider.label}
        className={cn(
          "pointer-events-none fixed right-0 top-[4.75rem] z-[100] flex max-h-[calc(100dvh-5rem)] w-full flex-col gap-2 p-4 sm:w-[min(26rem,calc(100vw-2rem))]",
          className,
        )}
        {...props}
      />
    );
  },
);
ToastViewport.displayName = "ToastViewport";

const toastBase =
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 border border-melon-300 border-l-4 p-4 pr-10 shadow-[4px_4px_0_rgba(18,67,53,0.16)] transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full dark:border-zinc-800";
const toastVariantClasses = {
  default: "bg-melon-25 text-melon-950 dark:bg-zinc-950 dark:text-zinc-50",
  destructive:
    "destructive group border-red-500 bg-red-500 text-zinc-50 dark:border-red-900 dark:bg-red-900 dark:text-zinc-50",
  warning: "border-peel-500 bg-peel-25 text-peel-950",
} as const;
type ToastVariant = keyof typeof toastVariantClasses;

function toastVariants({ variant }: { variant?: ToastVariant | null } = {}) {
  return cn(toastBase, toastVariantClasses[variant ?? "default"]);
}

type ToastContextValue = {
  close: () => void;
};
const ToastContext = React.createContext<ToastContextValue | null>(null);

function useToastRoot(component: string) {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error(`${component} must be used inside Toast`);
  return context;
}

interface ToastRootProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  defaultOpen?: boolean;
  duration?: number;
  forceMount?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  type?: "foreground" | "background";
  variant?: ToastVariant | null;
}

const Toast = React.forwardRef<HTMLDivElement, ToastRootProps>(
  (
    {
      className,
      defaultOpen = true,
      duration,
      forceMount = false,
      onBlur,
      onFocus,
      onMouseEnter,
      onMouseLeave,
      onOpenChange,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      open: controlledOpen,
      style,
      type: _type,
      variant,
      ...props
    },
    ref,
  ) => {
    const provider = React.useContext(ToastProviderContext);
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const open = controlledOpen ?? internalOpen;
    const controlled = controlledOpen !== undefined;
    const [present, setPresent] = React.useState(open);
    const [swipe, setSwipe] = React.useState<"cancel" | "end" | "move" | undefined>();
    const [swipeDelta, setSwipeDelta] = React.useState(0);
    const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const hideTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const pointerStart = React.useRef<{ id: number; x: number; y: number } | undefined>(undefined);

    const clearCloseTimer = React.useCallback(() => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    }, []);
    const setOpen = React.useCallback(
      (nextOpen: boolean) => {
        if (!controlled) setInternalOpen(nextOpen);
        if (nextOpen !== open) onOpenChange?.(nextOpen);
      },
      [controlled, onOpenChange, open],
    );
    const scheduleClose = React.useCallback(() => {
      clearCloseTimer();
      const resolvedDuration = duration ?? provider.duration;
      if (resolvedDuration === Infinity || resolvedDuration <= 0) return;
      closeTimer.current = setTimeout(() => setOpen(false), resolvedDuration);
    }, [clearCloseTimer, duration, provider.duration, setOpen]);

    React.useEffect(() => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (open) {
        setPresent(true);
        scheduleClose();
      } else {
        clearCloseTimer();
        hideTimer.current = setTimeout(() => setPresent(false), 200);
      }
      return () => {
        clearCloseTimer();
        if (hideTimer.current) clearTimeout(hideTimer.current);
      };
    }, [clearCloseTimer, open, scheduleClose]);

    const close = React.useCallback(() => {
      clearCloseTimer();
      setOpen(false);
    }, [clearCloseTimer, setOpen]);

    const getDirectionalDelta = (event: React.PointerEvent<HTMLDivElement>) => {
      const start = pointerStart.current;
      if (!start) return 0;
      return provider.swipeDirection === "left" || provider.swipeDirection === "right"
        ? event.clientX - start.x
        : event.clientY - start.y;
    };
    const direction =
      provider.swipeDirection === "left" || provider.swipeDirection === "up" ? -1 : 1;

    if (!present && !forceMount) return null;

    return (
      <ToastContext.Provider value={{ close }}>
        <div
          ref={ref}
          role={variant === "destructive" ? "alert" : "status"}
          aria-atomic="true"
          aria-hidden={!open || undefined}
          data-state={open ? "open" : "closed"}
          data-swipe={swipe}
          className={cn(toastVariants({ variant }), className)}
          style={
            {
              "--radix-toast-swipe-end-x": `${swipeDelta}px`,
              "--radix-toast-swipe-move-x": `${swipeDelta}px`,
              ...style,
            } as React.CSSProperties
          }
          onFocus={(event) => {
            onFocus?.(event);
            clearCloseTimer();
          }}
          onBlur={(event) => {
            onBlur?.(event);
            if (!event.currentTarget.contains(event.relatedTarget)) scheduleClose();
          }}
          onMouseEnter={(event) => {
            onMouseEnter?.(event);
            clearCloseTimer();
          }}
          onMouseLeave={(event) => {
            onMouseLeave?.(event);
            if (!event.defaultPrevented) scheduleClose();
          }}
          onPointerDown={(event) => {
            onPointerDown?.(event);
            if (event.defaultPrevented || event.button !== 0) return;
            pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
            clearCloseTimer();
          }}
          onPointerMove={(event) => {
            onPointerMove?.(event);
            if (event.defaultPrevented || pointerStart.current?.id !== event.pointerId) return;
            const delta = getDirectionalDelta(event);
            if (delta * direction < 0) return;
            // Capture only once a swipe is underway. Capturing on every press
            // retargets the click to the toast root, so the close button never
            // receives it.
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
            setSwipe("move");
            setSwipeDelta(delta);
          }}
          onPointerUp={(event) => {
            onPointerUp?.(event);
            if (event.defaultPrevented || pointerStart.current?.id !== event.pointerId) return;
            const delta = getDirectionalDelta(event);
            pointerStart.current = undefined;
            if (delta * direction >= provider.swipeThreshold) {
              setSwipe("end");
              setSwipeDelta(delta);
              close();
            } else {
              setSwipe("cancel");
              setSwipeDelta(0);
              window.setTimeout(() => setSwipe(undefined), 150);
              scheduleClose();
            }
          }}
          {...props}
        />
      </ToastContext.Provider>
    );
  },
);
Toast.displayName = "Toast";

interface ToastActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  altText?: string;
}

const ToastAction = React.forwardRef<HTMLButtonElement, ToastActionProps>(
  ({ altText: _altText, className, onClick, type, ...props }, ref) => {
    const context = useToastRoot("ToastAction");
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          "inline-flex h-8 shrink-0 items-center justify-center border border-zinc-200 bg-transparent px-3 text-sm font-medium ring-offset-white transition-colors hover:bg-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 group-[.destructive]:border-zinc-200/40 group-[.destructive]:hover:border-red-500/30 group-[.destructive]:hover:bg-red-500 group-[.destructive]:hover:text-zinc-50 group-[.destructive]:focus:ring-red-500 dark:border-zinc-800 dark:ring-offset-zinc-950 dark:hover:bg-zinc-800 dark:focus:ring-zinc-300 dark:group-[.destructive]:border-zinc-800/40 dark:group-[.destructive]:hover:border-red-900/30 dark:group-[.destructive]:hover:bg-red-900 dark:group-[.destructive]:hover:text-zinc-50 dark:group-[.destructive]:focus:ring-red-900",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) context.close();
        }}
        {...props}
      />
    );
  },
);
ToastAction.displayName = "ToastAction";

const ToastClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, onClick, type, ...props }, ref) => {
  const context = useToastRoot("ToastClose");
  return (
    <button
      ref={ref}
      type={type ?? "button"}
      aria-label={props["aria-label"] ?? "Close notification"}
      className={cn(
        "absolute right-2 top-2 p-1 text-zinc-950/60 transition-colors hover:text-zinc-950 focus:outline-none focus:ring-2 group-[.destructive]:text-red-100 group-[.destructive]:hover:text-white group-[.destructive]:focus:ring-red-400 group-[.destructive]:focus:ring-offset-red-600 dark:text-zinc-50/50 dark:hover:text-zinc-50",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) context.close();
      }}
      {...props}
    >
      <X aria-hidden="true" className="h-4 w-4" />
    </button>
  );
});
ToastClose.displayName = "ToastClose";

const ToastTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-sm font-semibold", className)} {...props} />
  ),
);
ToastTitle.displayName = "ToastTitle";

const ToastDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-sm opacity-90 break-words whitespace-pre-wrap", className)}
      {...props}
    />
  ),
);
ToastDescription.displayName = "ToastDescription";

type ToastProps = React.ComponentPropsWithoutRef<typeof Toast>;

type ToastActionElement = React.ReactElement<React.ComponentPropsWithoutRef<typeof ToastAction>>;

export {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  type ToastActionElement,
  type ToastProps,
};
