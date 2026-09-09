"use client";

import { Check, ChevronDown } from "@/components/ui/icons";
import * as React from "react";
import { createPortal } from "react-dom";

import { topLayerHost } from "@/lib/topLayer";
import { cn } from "@/lib/utils";
import { composeRefs } from "./slot";

type SelectOption = {
  disabled: boolean;
  label: React.ReactNode;
  textValue: string;
  value: string;
};

type SelectContextValue = {
  activeValue?: string;
  contentId: string;
  contentRef: React.RefObject<HTMLDivElement | null>;
  disabled: boolean;
  getOptions: () => SelectOption[];
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: string) => void;
  open: boolean;
  registerOption: (option: SelectOption) => () => void;
  selectedOption?: SelectOption;
  setActiveValue: (value?: string) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  value?: string;
};

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelect(component: string) {
  const context = React.useContext(SelectContext);
  if (!context) throw new Error(`${component} must be used inside Select`);
  return context;
}

function textFromNode(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join(" ");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return textFromNode(node.props.children);
  }
  return "";
}

function useControllableValue<T>({
  value,
  defaultValue,
  onChange,
}: {
  value?: T;
  defaultValue?: T;
  onChange?: (value: T) => void;
}) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const currentValue = controlled ? value : internalValue;
  const setValue = React.useCallback(
    (nextValue: T) => {
      if (!controlled) setInternalValue(nextValue);
      if (nextValue !== currentValue) onChange?.(nextValue);
    },
    [controlled, currentValue, onChange],
  );
  return [currentValue, setValue] as const;
}

interface SelectProps {
  children?: React.ReactNode;
  defaultOpen?: boolean;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
  onOpenChange?: (open: boolean) => void;
  onValueChange?: (value: string) => void;
  open?: boolean;
  required?: boolean;
  value?: string;
}

function Select({
  children,
  defaultOpen = false,
  defaultValue,
  disabled = false,
  name,
  onOpenChange,
  onValueChange,
  open: controlledOpen,
  required,
  value: controlledValue,
}: SelectProps) {
  const [value, setValue] = useControllableValue({
    value: controlledValue,
    defaultValue,
    onChange: onValueChange,
  });
  const [openValue, setOpen] = useControllableValue<boolean>({
    value: controlledOpen,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  });
  const open = openValue ?? false;
  const [activeValue, setActiveValue] = React.useState<string>();
  const optionsRef = React.useRef(new Map<string, SelectOption>());
  const [optionsVersion, setOptionsVersion] = React.useState(0);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId().replace(/:/g, "");

  const registerOption = React.useCallback((option: SelectOption) => {
    optionsRef.current.set(option.value, option);
    setOptionsVersion((version) => version + 1);
    return () => {
      optionsRef.current.delete(option.value);
      setOptionsVersion((version) => version + 1);
    };
  }, []);
  const getOptions = React.useCallback(() => Array.from(optionsRef.current.values()), []);

  React.useEffect(() => {
    if (!open) return;
    const options = getOptions().filter((option) => !option.disabled);
    if (!options.some((option) => option.value === activeValue)) {
      setActiveValue(options.find((option) => option.value === value)?.value ?? options[0]?.value);
    }
  }, [activeValue, getOptions, open, optionsVersion, value]);

  const options = React.useMemo(() => {
    // The registry lives in a ref; the version makes additions and removals
    // observable without recreating registration callbacks.
    void optionsVersion;
    return getOptions();
  }, [getOptions, optionsVersion]);

  const context = React.useMemo<SelectContextValue>(
    () => ({
      activeValue,
      contentId: `select-content-${id}`,
      contentRef,
      disabled,
      getOptions,
      onOpenChange: (nextOpen) => {
        if (disabled) return;
        if (nextOpen) {
          const enabledOptions = getOptions().filter((option) => !option.disabled);
          setActiveValue(
            enabledOptions.find((option) => option.value === value)?.value ??
              enabledOptions[0]?.value,
          );
        }
        setOpen(nextOpen);
      },
      onValueChange: (nextValue) => {
        if (disabled) return;
        setActiveValue(nextValue);
        setValue(nextValue);
        setOpen(false);
        queueMicrotask(() => triggerRef.current?.focus({ preventScroll: true }));
      },
      open,
      registerOption,
      selectedOption:
        value === undefined ? undefined : options.find((option) => option.value === value),
      setActiveValue,
      triggerRef,
      value,
    }),
    [
      activeValue,
      disabled,
      getOptions,
      id,
      open,
      options,
      registerOption,
      setOpen,
      setValue,
      value,
    ],
  );

  return (
    <SelectContext.Provider value={context}>
      {children}
      {name ? (
        <input
          type="text"
          name={name}
          value={value ?? ""}
          required={required}
          disabled={disabled}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        />
      ) : null}
    </SelectContext.Provider>
  );
}

function moveActive(context: SelectContextValue, direction: 1 | -1 | "first" | "last") {
  const options = context.getOptions().filter((option) => !option.disabled);
  if (options.length === 0) return;
  if (direction === "first") {
    context.setActiveValue(options[0].value);
    return;
  }
  if (direction === "last") {
    context.setActiveValue(options[options.length - 1].value);
    return;
  }

  const currentIndex = options.findIndex(
    (option) => option.value === (context.activeValue ?? context.value),
  );
  const nextIndex =
    currentIndex < 0
      ? direction === 1
        ? 0
        : options.length - 1
      : (currentIndex + direction + options.length) % options.length;
  context.setActiveValue(options[nextIndex].value);
}

const SelectTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(
  (
    { className, children, disabled: triggerDisabled, onClick, onKeyDown, type, ...props },
    forwardedRef,
  ) => {
    const context = useSelect("SelectTrigger");
    const ref = composeRefs(forwardedRef, context.triggerRef);
    const searchRef = React.useRef("");
    const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    React.useEffect(
      () => () => {
        if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      },
      [],
    );

    const findByTypeahead = (character: string) => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchRef.current += character.toLocaleLowerCase();
      searchTimerRef.current = setTimeout(() => {
        searchRef.current = "";
      }, 700);
      const options = context.getOptions().filter((option) => !option.disabled);
      const startIndex = options.findIndex(
        (option) => option.value === (context.activeValue ?? context.value),
      );
      const ordered = [...options.slice(startIndex + 1), ...options.slice(0, startIndex + 1)];
      const match = ordered.find((option) =>
        option.textValue.toLocaleLowerCase().startsWith(searchRef.current),
      );
      if (!match) return;
      if (context.open) context.setActiveValue(match.value);
      else context.onValueChange(match.value);
    };

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        role="combobox"
        aria-controls={context.contentId}
        aria-expanded={context.open}
        aria-haspopup="listbox"
        aria-activedescendant={
          context.open && context.activeValue
            ? `${context.contentId}-option-${encodeURIComponent(context.activeValue)}`
            : undefined
        }
        data-state={context.open ? "open" : "closed"}
        data-placeholder={context.value === undefined ? "" : undefined}
        disabled={context.disabled || triggerDisabled}
        className={cn(
          "flex h-10 w-full items-center justify-between border-2 border-melon-300 bg-melon-25 px-3 py-2 text-sm placeholder:text-zinc-500 hover:border-melon-400 focus:border-melon-600 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
          className,
        )}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) context.onOpenChange(!context.open);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;

          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!context.open) context.onOpenChange(true);
            moveActive(context, event.key === "ArrowDown" ? 1 : -1);
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            if (!context.open) context.onOpenChange(true);
            moveActive(context, event.key === "Home" ? "first" : "last");
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (context.open && context.activeValue !== undefined) {
              context.onValueChange(context.activeValue);
            } else {
              context.onOpenChange(true);
            }
          } else if (event.key === "Escape" && context.open) {
            event.preventDefault();
            context.onOpenChange(false);
          } else if (event.key === "Tab") {
            context.onOpenChange(false);
          } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
            findByTypeahead(event.key);
          }
        }}
        {...props}
      >
        {children}
        <ChevronDown aria-hidden="true" className="h-4 w-4 opacity-50" />
      </button>
    );
  },
);
SelectTrigger.displayName = "SelectTrigger";

interface SelectValueProps extends React.HTMLAttributes<HTMLSpanElement> {
  placeholder?: React.ReactNode;
}

const SelectValue = React.forwardRef<HTMLSpanElement, SelectValueProps>(
  ({ children, placeholder, ...props }, ref) => {
    const context = useSelect("SelectValue");
    const content =
      children ??
      (context.value === undefined || context.value === ""
        ? placeholder
        : (context.selectedOption?.label ?? context.value));
    return (
      <span
        ref={ref}
        data-placeholder={context.value === undefined || context.value === "" ? "" : undefined}
        {...props}
      >
        {content}
      </span>
    );
  },
);
SelectValue.displayName = "SelectValue";

function useSelectPortal() {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    const portal = document.createElement("div");
    portal.dataset.uiSelectPortal = "";
    topLayerHost().appendChild(portal);
    setNode(portal);
    return () => portal.remove();
  }, []);
  return node;
}

interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {
  align?: "start" | "center" | "end";
  position?: "item-aligned" | "popper";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
}

const SelectContent = React.forwardRef<HTMLDivElement, SelectContentProps>(
  (
    {
      align = "start",
      className,
      children,
      position = "popper",
      side,
      sideOffset = 4,
      style,
      ...props
    },
    forwardedRef,
  ) => {
    const context = useSelect("SelectContent");
    const portal = useSelectPortal();
    const ref = composeRefs(forwardedRef, context.contentRef);
    const [layout, setLayout] = React.useState<{
      left: number;
      side: "top" | "bottom";
      top: number;
      triggerHeight: number;
      triggerWidth: number;
    }>();

    const updatePosition = React.useCallback(() => {
      const trigger = context.triggerRef.current;
      const content = context.contentRef.current;
      if (!trigger || !content) return;
      const triggerRect = trigger.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const resolvedSide =
        side === "top" || side === "bottom"
          ? side
          : window.innerHeight - triggerRect.bottom >= contentRect.height + sideOffset
            ? "bottom"
            : "top";
      let left =
        align === "end"
          ? triggerRect.right - contentRect.width
          : align === "center"
            ? triggerRect.left + (triggerRect.width - contentRect.width) / 2
            : triggerRect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - contentRect.width - 8));
      const top =
        resolvedSide === "bottom"
          ? triggerRect.bottom + sideOffset
          : triggerRect.top - contentRect.height - sideOffset;
      setLayout({
        left,
        side: resolvedSide,
        top: Math.max(8, top),
        triggerHeight: triggerRect.height,
        triggerWidth: triggerRect.width,
      });
    }, [align, context.contentRef, context.triggerRef, side, sideOffset]);

    React.useLayoutEffect(() => {
      if (!context.open) return;
      // The option registry is mounted while closed. Re-host it when it
      // becomes interactive: that puts it at the top of the stacking order,
      // and inside the open dialog when the select lives in one.
      if (portal) topLayerHost().appendChild(portal);
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
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node;
        if (
          !context.contentRef.current?.contains(target) &&
          !context.triggerRef.current?.contains(target)
        ) {
          context.onOpenChange(false);
        }
      };
      document.addEventListener("pointerdown", handlePointerDown, true);
      return () => document.removeEventListener("pointerdown", handlePointerDown, true);
    }, [context]);

    React.useEffect(() => {
      if (!context.open || !context.activeValue) return;
      const option = document.getElementById(
        `${context.contentId}-option-${encodeURIComponent(context.activeValue)}`,
      );
      option?.scrollIntoView?.({ block: "nearest" });
    }, [context.activeValue, context.contentId, context.contentRef, context.open]);

    if (!portal) return null;
    const cssVariables = {
      "--radix-select-trigger-height": `${layout?.triggerHeight ?? 0}px`,
      "--radix-select-trigger-width": `${layout?.triggerWidth ?? 0}px`,
    } as React.CSSProperties;

    return createPortal(
      <div
        ref={ref}
        id={context.contentId}
        role="listbox"
        aria-hidden={!context.open}
        hidden={!context.open}
        data-state={context.open ? "open" : "closed"}
        data-side={layout?.side ?? side ?? "bottom"}
        className={cn(
          "fixed z-50 max-h-96 min-w-[8rem] overflow-y-auto border border-zinc-200 bg-white text-zinc-950 shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className,
        )}
        style={{
          ...cssVariables,
          left: layout?.left ?? -10_000,
          minWidth: layout?.triggerWidth,
          top: layout?.top ?? -10_000,
          ...style,
        }}
        {...props}
      >
        <div className="p-1">{children}</div>
      </div>,
      portal,
    );
  },
);
SelectContent.displayName = "SelectContent";

const SelectGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  (props, ref) => <div ref={ref} role="group" {...props} />,
);
SelectGroup.displayName = "SelectGroup";

const SelectLabel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)} {...props} />
  ),
);
SelectLabel.displayName = "SelectLabel";

interface SelectItemProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect"> {
  disabled?: boolean;
  textValue?: string;
  value: string;
}

const SelectItem = React.forwardRef<HTMLDivElement, SelectItemProps>(
  (
    { className, children, disabled = false, onClick, onPointerMove, textValue, value, ...props },
    ref,
  ) => {
    const context = useSelect("SelectItem");
    const registerOption = context.registerOption;
    const option = React.useMemo<SelectOption>(
      () => ({
        disabled,
        label: children,
        textValue: textValue ?? textFromNode(children).trim(),
        value,
      }),
      [children, disabled, textValue, value],
    );
    React.useLayoutEffect(() => registerOption(option), [option, registerOption]);
    const selected = context.value === value;
    const highlighted = context.activeValue === value;

    return (
      <div
        ref={ref}
        id={`${context.contentId}-option-${encodeURIComponent(value)}`}
        role="option"
        aria-disabled={disabled || undefined}
        aria-selected={selected}
        data-disabled={disabled ? "" : undefined}
        data-highlighted={highlighted ? "" : undefined}
        data-select-value={value}
        data-state={selected ? "checked" : "unchecked"}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 dark:data-[highlighted]:bg-zinc-800 dark:data-[highlighted]:text-zinc-50",
          className,
        )}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          if (!disabled && !event.defaultPrevented) context.setActiveValue(value);
        }}
        onClick={(event) => {
          onClick?.(event);
          if (!disabled && !event.defaultPrevented) context.onValueChange(value);
        }}
        {...props}
      >
        <span
          aria-hidden="true"
          className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center"
        >
          {selected ? <Check className="h-4 w-4" /> : null}
        </span>
        {children}
      </div>
    );
  },
);
SelectItem.displayName = "SelectItem";

const SelectSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      role="separator"
      className={cn("-mx-1 my-1 h-px bg-zinc-100 dark:bg-zinc-800", className)}
      {...props}
    />
  ),
);
SelectSeparator.displayName = "SelectSeparator";

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
