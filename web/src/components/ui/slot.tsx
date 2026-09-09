"use client";

import * as React from "react";

type AnyProps = Record<string, unknown>;

function setRef<T>(ref: React.ForwardedRef<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

export function composeRefs<T>(
  ...refs: Array<React.ForwardedRef<T> | undefined>
): React.RefCallback<T> {
  return (value) => {
    refs.forEach((ref) => setRef(ref, value));
  };
}

function mergeProps(parentProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged = { ...parentProps, ...childProps };

  for (const key of Object.keys(parentProps)) {
    const parentValue = parentProps[key];
    const childValue = childProps[key];

    if (
      /^on[A-Z]/.test(key) &&
      typeof parentValue === "function" &&
      typeof childValue === "function"
    ) {
      merged[key] = (...args: unknown[]) => {
        childValue(...args);
        parentValue(...args);
      };
    } else if (key === "className") {
      merged[key] = [parentValue, childValue].filter(Boolean).join(" ");
    } else if (key === "style") {
      merged[key] = {
        ...(parentValue as React.CSSProperties | undefined),
        ...(childValue as React.CSSProperties | undefined),
      };
    }
  }

  return merged;
}

export interface SlotProps extends React.HTMLAttributes<HTMLElement> {
  children: React.ReactElement;
}

/**
 * A small, dependency-free equivalent of Radix Slot for this app's `asChild`
 * APIs. It preserves the child's element and merges handlers, styles, classes,
 * and refs onto it.
 */
export const Slot = React.forwardRef<HTMLElement, SlotProps>(
  ({ children, ...props }, forwardedRef) => {
    if (!React.isValidElement<AnyProps>(children)) {
      return null;
    }

    const childRef = (children as React.ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
    return React.cloneElement(children, {
      ...mergeProps(props as AnyProps, children.props),
      ref: composeRefs(forwardedRef, childRef),
    });
  },
);
Slot.displayName = "Slot";
