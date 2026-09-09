"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { gatewayRequest } from "./api";

type Resource<T> = { data: T | null; loading: boolean; error: string | null };
const emptyResource = { data: null, loading: true, error: null };

/** Bind every render to its request identity; a stalled poll cannot freeze live credit. */
export function useGatewayResource<T>(path: string, parse: (value: unknown) => T) {
  const [attempt, setAttempt] = useState(0);
  const identity = useMemo(() => ({ path, parse, attempt }), [path, parse, attempt]);
  const [resource, setResource] = useState<(Resource<T> & { identity: typeof identity }) | null>(
    null,
  );
  const [now, setNow] = useState(Date.now);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let currentRequest: AbortController | null = null;
    let pending = false;
    async function refresh() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      const request = new AbortController();
      currentRequest = request;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          gatewayRequest<unknown>(identity.path, { signal: request.signal }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              request.abort();
              reject(new Error("The compute gateway took too long to respond. Try again."));
            }, 15_000);
          }),
        ]);
        const data = identity.parse(result);
        if (!controller.signal.aborted)
          setResource({ identity, data, loading: false, error: null });
      } catch (error) {
        if (!controller.signal.aborted)
          setResource({
            identity,
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : "The compute gateway is unavailable.",
          });
      } finally {
        clearTimeout(timeout);
        if (currentRequest === request) currentRequest = null;
        pending = false;
      }
    }
    void refresh();
    // Time advances independently of the network so freshness and UTC resets
    // are re-evaluated even if a provider request never resolves.
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void refresh(), 30_000);
    const resume = () => {
      setNow(Date.now());
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      controller.abort();
      currentRequest?.abort();
      window.clearInterval(clock);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [identity]);
  // Effects run after rendering. Filtering here prevents a route change from
  // rendering the old project's funding action even for one frame.
  const current = resource?.identity === identity ? resource : emptyResource;
  return { data: current.data, loading: current.loading, error: current.error, now, retry };
}
