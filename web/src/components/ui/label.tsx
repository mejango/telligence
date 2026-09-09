"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const labelClasses =
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70";

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, onClick, ...props }, ref) => (
    <label
      ref={ref}
      className={cn(labelClasses, className)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !props.htmlFor) return;

        const target = document.getElementById(props.htmlFor);
        if (target && !target.matches("input, select, textarea, button")) {
          target.closest<HTMLElement>('[role="combobox"]')?.focus();
        }
      }}
      {...props}
    />
  ),
);
Label.displayName = "Label";

export { Label };
