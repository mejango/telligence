import { useEffect, useState } from "react";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Whole seconds until `end` (unix seconds), ticking each second until it passes, then 0.
 * Undefined without an end.
 */
export function useSecondsUntil(end: number | undefined): number | undefined {
  const [now, setNow] = useState(nowSeconds);
  const ticking = !!end && end > now;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(nowSeconds()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  return end ? Math.max(0, end - now) : undefined;
}
