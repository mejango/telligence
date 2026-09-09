"use client";

import { topLayerHost } from "@/lib/topLayer";
import { cn } from "@/lib/utils";
import * as React from "react";
import { createPortal } from "react-dom";
import { composeRefs, Slot } from "./slot";

type TooltipProviderValue = {
  delayDuration: number;
  markClosed: () => void;
  skipDelayDuration: number;
  wasRecentlyOpen: () => boolean;
};

const defaultProvider: TooltipProviderValue = {
  // Short enough to feel like a response to the hover rather than a timeout.
  // The browser's own `title` delay is ~1s, which reads as broken.
  delayDuration: 200,
  markClosed: () => {},
  skipDelayDuration: 300,
  wasRecentlyOpen: () => false,
};
const TooltipProviderContext = React.createContext(defaultProvider);

interface TooltipProviderProps {
  children?: React.ReactNode;
  delayDuration?: number;
  disableHoverableContent?: boolean;
  skipDelayDuration?: number;
}

function TooltipProvider({
  children,
  delayDuration = 200,
  skipDelayDuration = 300,
}: TooltipProviderProps) {
  const lastClosedAt = React.useRef(0);
  const value = React.useMemo<TooltipProviderValue>(
    () => ({
      delayDuration,
      markClosed: () => {
        lastClosedAt.current = Date.now();
      },
      skipDelayDuration,
      wasRecentlyOpen: () => Date.now() - lastClosedAt.current < skipDelayDuration,
    }),
    [delayDuration, skipDelayDuration],
  );
  return (
    <TooltipProviderContext.Provider value={value}>{children}</TooltipProviderContext.Provider>
  );
}

type TooltipContextValue = {
  cancelClose: () => void;
  close: () => void;
  contentId: string;
  open: boolean;
  scheduleClose: () => void;
  scheduleOpen: (immediate?: boolean) => void;
  setOpen: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
};

const TooltipContext = React.createContext<TooltipContextValue | null>(null);

function useTooltip(component: string) {
  const context = React.useContext(TooltipContext);
  if (!context) throw new Error(`${component} must be used inside Tooltip`);
  return context;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      const update = () => setIsMobile(window.innerWidth < 768);
      update();
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobile;
}

interface TooltipProps {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  delayDuration?: number;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

function Tooltip({
  children,
  defaultOpen = false,
  delayDuration,
  onOpenChange,
  open: controlledOpen,
}: TooltipProps) {
  const provider = React.useContext(TooltipProviderContext);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const controlled = controlledOpen !== undefined;
  const triggerRef = React.useRef<HTMLElement>(null);
  const openTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = React.useId().replace(/:/g, "");

  const setOpen = React.useCallback(
    (nextOpen: boolean) => {
      if (!controlled) setInternalOpen(nextOpen);
      if (nextOpen !== open) onOpenChange?.(nextOpen);
      if (!nextOpen && open) provider.markClosed();
    },
    [controlled, onOpenChange, open, provider],
  );
  const cancelOpen = React.useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
  }, []);
  const cancelClose = React.useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const close = React.useCallback(() => {
    cancelOpen();
    cancelClose();
    setOpen(false);
  }, [cancelClose, cancelOpen, setOpen]);
  const scheduleOpen = React.useCallback(
    (immediate = false) => {
      cancelClose();
      cancelOpen();
      const delay =
        immediate || provider.wasRecentlyOpen() ? 0 : (delayDuration ?? provider.delayDuration);
      if (delay === 0) setOpen(true);
      else openTimer.current = setTimeout(() => setOpen(true), delay);
    },
    [cancelClose, cancelOpen, delayDuration, provider, setOpen],
  );
  const scheduleClose = React.useCallback(() => {
    cancelOpen();
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 100);
  }, [cancelClose, cancelOpen, setOpen]);

  React.useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [cancelClose, cancelOpen],
  );

  const context = React.useMemo<TooltipContextValue>(
    () => ({
      cancelClose,
      close,
      contentId: `tooltip-${id}`,
      open,
      scheduleClose,
      scheduleOpen,
      setOpen,
      triggerRef,
    }),
    [cancelClose, close, id, open, scheduleClose, scheduleOpen, setOpen],
  );

  return <TooltipContext.Provider value={context}>{children}</TooltipContext.Provider>;
}

interface TooltipTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const TooltipTrigger = React.forwardRef<HTMLElement, TooltipTriggerProps>(
  (
    {
      asChild = false,
      children,
      onBlur,
      onClick,
      onFocus,
      onPointerEnter,
      onPointerLeave,
      tabIndex,
      type,
      ...props
    },
    forwardedRef,
  ) => {
    const context = useTooltip("TooltipTrigger");
    const isMobile = useIsMobile();
    const ref = composeRefs(forwardedRef, context.triggerRef);
    const sharedProps = {
      "aria-describedby": context.open ? context.contentId : undefined,
      "data-state": context.open ? "open" : "closed",
      tabIndex: asChild ? (tabIndex ?? 0) : tabIndex,
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        onBlur?.(event as React.FocusEvent<HTMLButtonElement>);
        if (!isMobile && !event.defaultPrevented) context.scheduleClose();
      },
      onClick: (event: React.MouseEvent<HTMLElement>) => {
        onClick?.(event as React.MouseEvent<HTMLButtonElement>);
        if (isMobile && !event.defaultPrevented) {
          event.preventDefault();
          context.setOpen(!context.open);
        }
      },
      onFocus: (event: React.FocusEvent<HTMLElement>) => {
        onFocus?.(event as React.FocusEvent<HTMLButtonElement>);
        // A touch tap focuses before it clicks. Opening here would make the
        // following click immediately toggle the tooltip closed.
        if (!isMobile && !event.defaultPrevented) context.scheduleOpen(true);
      },
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
        onPointerEnter?.(event as React.PointerEvent<HTMLButtonElement>);
        if (!isMobile && !event.defaultPrevented && event.pointerType !== "touch") {
          context.scheduleOpen();
        }
      },
      onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
        onPointerLeave?.(event as React.PointerEvent<HTMLButtonElement>);
        // Touch pointers emit leave events after a tap. Keep the tooltip open
        // until the trigger is tapped again or the user taps elsewhere.
        if (!isMobile && !event.defaultPrevented && event.pointerType !== "touch") {
          context.scheduleClose();
        }
      },
      ...props,
    };

    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(children) as React.ReactElement}
        </Slot>
      );
    }

    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} type={type ?? "button"} {...sharedProps}>
        {children}
      </button>
    );
  },
);
TooltipTrigger.displayName = "TooltipTrigger";

function useTooltipPortal(open: boolean) {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const portal = document.createElement("div");
    portal.dataset.uiTooltipPortal = "";
    topLayerHost().appendChild(portal);
    setNode(portal);
    return () => {
      portal.remove();
      setNode(null);
    };
  }, [open]);
  return node;
}

interface TooltipContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

const TooltipContent = React.forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    {
      align = "center",
      className,
      onPointerEnter,
      onPointerLeave,
      side: requestedSide,
      sideOffset = 4,
      style,
      ...props
    },
    forwardedRef,
  ) => {
    const context = useTooltip("TooltipContent");
    const isMobile = useIsMobile();
    const side = isMobile ? "top" : (requestedSide ?? "top");
    const portal = useTooltipPortal(context.open);
    const localRef = React.useRef<HTMLDivElement>(null);
    const ref = composeRefs(forwardedRef, localRef);
    const [position, setPosition] = React.useState({ left: -10_000, top: -10_000 });

    const updatePosition = React.useCallback(() => {
      const trigger = context.triggerRef.current;
      const content = localRef.current;
      if (!trigger || !content) return;
      const triggerRect = trigger.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const centerX = triggerRect.left + triggerRect.width / 2;
      const centerY = triggerRect.top + triggerRect.height / 2;
      let left =
        align === "start"
          ? triggerRect.left
          : align === "end"
            ? triggerRect.right - contentRect.width
            : centerX - contentRect.width / 2;
      let top =
        side === "bottom"
          ? triggerRect.bottom + sideOffset
          : side === "left" || side === "right"
            ? centerY - contentRect.height / 2
            : triggerRect.top - contentRect.height - sideOffset;
      if (side === "left") left = triggerRect.left - contentRect.width - sideOffset;
      if (side === "right") left = triggerRect.right + sideOffset;
      left = Math.max(8, Math.min(left, window.innerWidth - contentRect.width - 8));
      top = Math.max(8, Math.min(top, window.innerHeight - contentRect.height - 8));
      setPosition({ left, top });
    }, [align, context.triggerRef, side, sideOffset]);

    React.useLayoutEffect(() => {
      if (!context.open || !portal) return;
      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }, [context.open, portal, updatePosition]);

    React.useEffect(() => {
      if (!context.open) return;
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape") context.close();
      };
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node;
        if (!localRef.current?.contains(target) && !context.triggerRef.current?.contains(target)) {
          context.close();
        }
      };
      document.addEventListener("keydown", handleKeyDown, true);
      document.addEventListener("pointerdown", handlePointerDown, true);
      return () => {
        document.removeEventListener("keydown", handleKeyDown, true);
        document.removeEventListener("pointerdown", handlePointerDown, true);
      };
    }, [context]);

    if (!context.open || !portal) return null;

    return createPortal(
      <div
        ref={ref}
        id={context.contentId}
        role="tooltip"
        data-side={side}
        data-state="open"
        className={cn(
          "fixed z-50 border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-950 shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
          isMobile && "w-60 max-h-64 overflow-y-auto",
          className,
        )}
        style={{ left: position.left, top: position.top, ...style }}
        onPointerEnter={(event) => {
          onPointerEnter?.(event);
          if (!event.defaultPrevented) context.cancelClose();
        }}
        onPointerLeave={(event) => {
          onPointerLeave?.(event);
          if (!event.defaultPrevented) context.scheduleClose();
        }}
        {...props}
      />,
      portal,
    );
  },
);
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
