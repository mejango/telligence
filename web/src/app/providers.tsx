"use client";

import React from "react";
import { AppSpecificProviders } from "./AppSpecificProviders";

/**
 * These providers used to load through `dynamic(..., { ssr: false })`, a workaround
 * for a 2025 provider stack that "wouldn't compile". It cost the site every byte of
 * server-rendered HTML: each page reached a crawler as a loading skeleton. Para is
 * lazy on its own now, wagmi runs with `ssr: true`, and query persistence no-ops
 * without a `window`, so nothing below here needs the browser in order to render.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <AppSpecificProviders>{children}</AppSpecificProviders>;
}
