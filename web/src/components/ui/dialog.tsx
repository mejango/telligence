"use client";

import { X } from "@/components/ui/icons";
import * as React from "react";
import { createPortal } from "react-dom";

import { registerOpenDialog } from "@/lib/topLayer";
import { cn } from "@/lib/utils";
import { composeRefs, Slot } from "./slot";

type DialogContextValue = {
  contentId: string;
  descriptionId: string;
  hasDescription: boolean;
  hasTitle: boolean;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  /** The content panel, for a view that replaces the dialog's body in place. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  registerDescription: () => () => void;
  registerTitle: () => () => void;
  titleId: string;
  triggerRef: React.RefObject<HTMLElement | null>;
};

const DialogContext = React.createContext<DialogContextValue | null>(null);

function useDialog(component: string) {
  const context = React.useContext(DialogContext);
  if (!context) throw new Error(`${component} must be used inside Dialog`);
  return context;
}

function useControllableState({
  value,
  defaultValue,
  onChange,
}: {
  value?: boolean;
  defaultValue: boolean;
  onChange?: (value: boolean) => void;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const currentValue = controlled ? value : internalValue;
  const setValue = React.useCallback(
    (nextValue: boolean) => {
      if (!controlled) setInternalValue(nextValue);
      if (nextValue !== currentValue) onChange?.(nextValue);
    },
    [controlled, currentValue, onChange],
  );
  return [currentValue, setValue] as const;
}

interface DialogProps {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

function Dialog({
  children,
  defaultOpen = false,
  onOpenChange,
  open: controlledOpen,
}: DialogProps) {
  const [open, setOpen] = useControllableState({
    value: controlledOpen,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const reactId = React.useId().replace(/:/g, "");
  const triggerRef = React.useRef<HTMLElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [titleCount, setTitleCount] = React.useState(0);
  const [descriptionCount, setDescriptionCount] = React.useState(0);
  const registerTitle = React.useCallback(() => {
    setTitleCount((count) => count + 1);
    return () => setTitleCount((count) => Math.max(0, count - 1));
  }, []);
  const registerDescription = React.useCallback(() => {
    setDescriptionCount((count) => count + 1);
    return () => setDescriptionCount((count) => Math.max(0, count - 1));
  }, []);

  const context = React.useMemo<DialogContextValue>(
    () => ({
      contentId: `dialog-content-${reactId}`,
      descriptionId: `dialog-description-${reactId}`,
      hasDescription: descriptionCount > 0,
      hasTitle: titleCount > 0,
      onOpenChange: setOpen,
      open,
      panelRef,
      registerDescription,
      registerTitle,
      titleId: `dialog-title-${reactId}`,
      triggerRef,
    }),
    [descriptionCount, open, reactId, registerDescription, registerTitle, setOpen, titleCount],
  );

  return <DialogContext.Provider value={context}>{children}</DialogContext.Provider>;
}

interface DialogTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DialogTrigger = React.forwardRef<HTMLElement, DialogTriggerProps>(
  ({ asChild = false, onClick, type, ...props }, forwardedRef) => {
    const context = useDialog("DialogTrigger");
    const ref = composeRefs(forwardedRef, context.triggerRef);
    const handleClick: React.MouseEventHandler<HTMLElement> = (event) => {
      onClick?.(event as React.MouseEvent<HTMLButtonElement>);
      if (!event.defaultPrevented) context.onOpenChange(true);
    };
    const sharedProps = {
      "aria-controls": context.contentId,
      "aria-expanded": context.open,
      "aria-haspopup": "dialog" as const,
      "data-state": context.open ? "open" : "closed",
      onClick: handleClick,
      ...props,
    };

    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }

    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} type={type ?? "button"} {...sharedProps} />
    );
  },
);
DialogTrigger.displayName = "DialogTrigger";

function useDialogPortalNode(open: boolean) {
  const [portalNode, setPortalNode] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) {
      setPortalNode(null);
      return;
    }
    const node = document.createElement("div");
    node.dataset.uiDialogPortal = "";
    document.body.appendChild(node);
    setPortalNode(node);
    return () => node.remove();
  }, [open]);
  return portalNode;
}

interface DialogCloseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
}

const DialogClose = React.forwardRef<HTMLElement, DialogCloseProps>(
  ({ asChild = false, onClick, type, ...props }, ref) => {
    const context = useDialog("DialogClose");
    const handleClick: React.MouseEventHandler<HTMLElement> = (event) => {
      onClick?.(event as React.MouseEvent<HTMLButtonElement>);
      if (!event.defaultPrevented) context.onOpenChange(false);
    };
    const sharedProps = { onClick: handleClick, ...props };

    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }

    return (
      <button ref={ref as React.Ref<HTMLButtonElement>} type={type ?? "button"} {...sharedProps} />
    );
  },
);
DialogClose.displayName = "DialogClose";

let bodyLockCount = 0;
let originalBodyOverflow = "";

/**
 * The top layer is the browser's job; scroll is not. `showModal()` inerts the
 * page behind the dialog but still lets it scroll, so the lock stays here and
 * stays reference counted: only the first open captures the document state and
 * only the last close restores it.
 */
function lockBody() {
  bodyLockCount += 1;
  if (bodyLockCount > 1) return;
  originalBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
}

function unlockBody() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount > 0) return;
  document.body.style.overflow = originalBodyOverflow;
}

/**
 * Dialogs replace rather than stack: the dialog below a newly opened one stays
 * open in the top layer but paints nothing (see `[data-covered]` in
 * globals.css) until the newer one closes. Returns the uncover.
 */
function coverDialogsBelow(dialog: HTMLDialogElement) {
  const covered = Array.from(
    document.querySelectorAll<HTMLDialogElement>("dialog[open]:not([data-covered])"),
  ).filter((other) => other !== dialog);
  covered.forEach((other) => other.setAttribute("data-covered", ""));
  return () => covered.forEach((other) => other.removeAttribute("data-covered"));
}

function useNativeModalDialog({
  dialogRef,
  enabled,
  onEscapeKeyDown,
  onOpenChange,
  open,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  enabled: boolean;
  onEscapeKeyDown?: (event: Event) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  // Callers pass inline arrows, so these identities change on every parent
  // render. Reading them through a ref keeps the effect below tied to real
  // state changes instead of re-running (and re-opening the dialog) on every
  // quote refresh or keystroke in the card that owns the dialog.
  const callbacks = React.useRef({ onEscapeKeyDown, onOpenChange });
  React.useLayoutEffect(() => {
    callbacks.current = { onEscapeKeyDown, onOpenChange };
  });

  React.useLayoutEffect(() => {
    if (!open || !enabled) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // `showModal()` throws on a dialog that is already open.
    if (!dialog.open) dialog.showModal();
    // `showModal()` hands focus to the first focusable descendant, the close button, and its focus
    // ring lit up on every open. Start on the dialog itself (it carries tabIndex -1) instead.
    dialog.focus({ preventScroll: true });
    const releaseTopLayer = registerOpenDialog(dialog);
    const uncover = coverDialogsBelow(dialog);
    lockBody();

    let closingForReact = false;
    const handleCancel = (event: Event) => {
      // Escape reaches only the topmost dialog. Preventing the cancel is how a
      // caller refuses dismissal, for instance while a send is in flight.
      callbacks.current.onEscapeKeyDown?.(event);
    };
    const handleClose = () => {
      if (closingForReact) return;
      callbacks.current.onOpenChange(false);
    };
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);

    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      uncover();
      releaseTopLayer();
      unlockBody();
      closingForReact = true;
      dialog.close();
    };
  }, [dialogRef, enabled, open]);
}

const DIALOG_PANEL_CLASS =
  "relative grid max-h-[90%] w-full max-w-lg gap-4 overflow-y-auto overscroll-none border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950";

interface DialogContentProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Runs on the native `cancel` event. Calling `preventDefault()` on it keeps
   * the dialog open, which is the only supported way to refuse a dismissal.
   */
  onEscapeKeyDown?: (event: Event) => void;
  /** Off for dialogs that render their own dismissal control. */
  showCloseButton?: boolean;
}

const DialogContent = React.forwardRef<HTMLDivElement, DialogContentProps>(
  ({ className, children, onEscapeKeyDown, showCloseButton = true, ...props }, forwardedRef) => {
    const context = useDialog("DialogContent");
    const dialogRef = React.useRef<HTMLDialogElement>(null);
    const portalNode = useDialogPortalNode(context.open);
    useNativeModalDialog({
      dialogRef,
      enabled: portalNode !== null,
      onEscapeKeyDown,
      onOpenChange: context.onOpenChange,
      open: context.open,
    });

    if (!context.open || !portalNode) return null;

    return createPortal(
      // `role="dialog"` and `aria-modal` are implicit for a dialog opened with
      // `showModal()`, and the backdrop is painted by `::backdrop`. The element
      // spans the viewport so a press on the empty area targets the dialog
      // itself and dismisses it, while presses inside the panel do not.
      <dialog
        ref={dialogRef}
        id={context.contentId}
        aria-labelledby={context.hasTitle ? context.titleId : undefined}
        aria-describedby={context.hasDescription ? context.descriptionId : undefined}
        tabIndex={-1}
        className="ui-dialog focus:outline-none"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) context.onOpenChange(false);
        }}
      >
        <div
          ref={composeRefs(forwardedRef, context.panelRef)}
          data-state="open"
          className={cn(DIALOG_PANEL_CLASS, className)}
          {...props}
        >
          {children}
          {showCloseButton ? (
            <DialogClose className="absolute right-4 top-4 opacity-70 ring-offset-white transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:ring-offset-2 disabled:pointer-events-none dark:ring-offset-zinc-950 dark:focus:ring-zinc-300">
              <X aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          ) : null}
        </div>
      </dialog>,
      portalNode,
    );
  },
);
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

interface DialogTextProps extends React.HTMLAttributes<HTMLElement> {
  asChild?: boolean;
}

const DialogTitle = React.forwardRef<HTMLElement, DialogTextProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const context = useDialog("DialogTitle");
    const registerTitle = context.registerTitle;
    React.useLayoutEffect(() => registerTitle(), [registerTitle]);
    const sharedProps = {
      id: context.titleId,
      className: cn("text-lg font-semibold leading-none", className),
      ...props,
    };
    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }
    return <h2 ref={ref as React.Ref<HTMLHeadingElement>} {...sharedProps} />;
  },
);
DialogTitle.displayName = "DialogTitle";

const DialogDescription = React.forwardRef<HTMLElement, DialogTextProps>(
  ({ asChild = false, className, ...props }, ref) => {
    const context = useDialog("DialogDescription");
    const registerDescription = context.registerDescription;
    React.useLayoutEffect(() => registerDescription(), [registerDescription]);
    const sharedProps = {
      id: context.descriptionId,
      className: cn("text-sm text-zinc-500 dark:text-zinc-400", className),
      ...props,
    };
    if (asChild) {
      return (
        <Slot ref={ref} {...sharedProps}>
          {React.Children.only(props.children) as React.ReactElement}
        </Slot>
      );
    }
    return <p ref={ref as React.Ref<HTMLParagraphElement>} {...sharedProps} />;
  },
);
DialogDescription.displayName = "DialogDescription";

/**
 * The content panel of the dialog this component is rendered inside, or null
 * when it is not inside one. A confirm view uses it to replace the body in
 * place rather than open a second dialog over the first.
 */
function useEnclosingDialogPanel(): HTMLDivElement | null {
  const context = React.useContext(DialogContext);
  const [panel, setPanel] = React.useState<HTMLDivElement | null>(null);
  React.useEffect(() => {
    setPanel(context?.panelRef.current ?? null);
  }, [context]);
  return context ? panel : null;
}

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useEnclosingDialogPanel,
};
