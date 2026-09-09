"use client";

import * as React from "react";

import { Loader2 } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { Slot } from "./slot";

const buttonBase =
  "inline-flex items-center justify-center text-sm font-medium text-zinc-950 dark:text-zinc-50 ring-offset-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 dark:ring-offset-zinc-950 dark:focus-visible:ring-zinc-300";
const buttonVariantClasses = {
  default:
    "bg-melon-500 text-melon-950 hover:bg-melon-600 hover:text-melon-950 dark:bg-melon-500 dark:text-melon-950 dark:hover:bg-melon-600",
  destructive:
    "bg-red-500 text-zinc-50 hover:bg-red-500/90 dark:bg-red-900 dark:text-zinc-50 dark:hover:bg-red-900/90",
  outline:
    "border border-zinc-200 bg-melon-50 hover:bg-melon-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
  bottomline:
    "border-b rounded-none rounded-t-md border-zinc-200 bg-white hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
  "tab-selected":
    "border-b rounded-none rounded-t-md border-zinc-500 bg-white hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
  secondary:
    "border border-melon-300 bg-melon-25 text-zinc-900 hover:border-melon-400 hover:bg-melon-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:border-zinc-600 dark:hover:bg-zinc-800",
  ghost: "hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-50",
  link: "text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50",
} as const;
const buttonSizeClasses = {
  default: "h-11 px-4 py-2",
  sm: "h-9 px-3",
  lg: "h-11 px-8 text-base",
  icon: "h-11 w-11",
} as const;

type ButtonVariant = keyof typeof buttonVariantClasses;
type ButtonSize = keyof typeof buttonSizeClasses;

function buttonVariants({
  className,
  size,
  variant,
}: {
  className?: string;
  size?: ButtonSize | null;
  variant?: ButtonVariant | null;
} = {}) {
  return cn(
    buttonBase,
    buttonVariantClasses[variant ?? "default"],
    buttonSizeClasses[size ?? "default"],
    className,
  );
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  loading?: boolean;
  size?: ButtonSize | null;
  variant?: ButtonVariant | null;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      children,
      className,
      disabled: disabledProp,
      loading,
      onClick,
      size,
      variant,
      ...props
    },
    ref,
  ) => {
    const disabled = disabledProp || loading;

    if (asChild) {
      const child = React.Children.only(children) as React.ReactElement<{
        children?: React.ReactNode;
        onClick?: React.MouseEventHandler<HTMLElement>;
      }>;
      const childProps = disabled
        ? {
            onClick: (event: React.MouseEvent<HTMLElement>) => {
              event.preventDefault();
              event.stopPropagation();
            },
          }
        : undefined;
      const slottedChild = React.cloneElement(
        child,
        childProps,
        loading
          ? [<Loader2 key="loading" className="mr-2 h-4 w-4 animate-spin" />, child.props.children]
          : child.props.children,
      );
      return (
        <Slot
          ref={ref as React.Ref<HTMLElement>}
          className={cn(buttonVariants({ variant, size, className }))}
          {...props}
          aria-disabled={disabled || undefined}
          data-disabled={disabled ? "" : undefined}
          onClick={(event) => {
            if (disabled) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            onClick?.(event as React.MouseEvent<HTMLButtonElement>);
          }}
          tabIndex={disabled ? -1 : props.tabIndex}
        >
          {slottedChild}
        </Slot>
      );
    }

    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        disabled={disabled}
        onClick={onClick}
      >
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button };
