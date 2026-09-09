"use client";

import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { useToast } from "@/components/ui/use-toast";
import { subscribeToTopLayer, topLayerHost } from "@/lib/topLayer";
import { wagmiConfig } from "@/lib/wagmiConfig";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";

export function Toaster() {
  const { hasOverflow, toasts } = useToast();
  const { address } = useAccount({ config: wagmiConfig });
  // Toasts are raised from inside dialogs (validation, upload failures), and a
  // dialog in the top layer paints its backdrop over every body-level element.
  // The viewport follows the topmost open dialog so those toasts stay visible.
  const host = useSyncExternalStore(
    subscribeToTopLayer,
    topLayerHost,
    () => null as HTMLElement | null,
  );
  if (!host) return null;

  return createPortal(
    <ToastProvider>
      <ToastViewport>
        {toasts.map(function ({ id, title, description, action, ...props }) {
          return (
            <Toast key={id} {...props}>
              <div className="flex flex-col w-full gap-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription className="flex-grow whitespace-pre-wrap break-words">
                    {description}
                  </ToastDescription>
                )}
              </div>
              {action}
              <ToastClose />
            </Toast>
          );
        })}
        {hasOverflow && address ? (
          <Link
            href={`/account/${address}`}
            className="pointer-events-auto self-end border-b border-melon-700 px-1 py-1 font-mono text-sm text-melon-800 hover:border-teal-600 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
          >
            See more in your account
          </Link>
        ) : null}
      </ToastViewport>
    </ToastProvider>,
    host,
  );
}
