"use client";

import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IS_DETERMINISTIC_BROWSER, PARA_EMBEDDED_WALLET_ENABLED } from "@/lib/browserEnvironment";
import { installQueryPersistence } from "@/lib/query-persist";
import { wagmiConfig } from "@/lib/wagmiConfig";
import { connectParaSession } from "@/providers/para-bridge";
import { verifyMarkedParaSession } from "@/providers/para-session";
import {
  ParaAuthContext,
  type ParaAddFundsRequest,
  type ParaRequest,
} from "@/providers/ParaAuthContext";
import { ParaConnectionNotice } from "@/providers/ParaConnectionNotice";
import { SignInPlaceholder } from "@/providers/SignInPlaceholder";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { useAccount, useConnect, useConnectors, WagmiProvider } from "wagmi";

const ParaModalHost = React.lazy(() => import("@/providers/ParaModalHost"));

function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
  return client;
}

export function ParaConnectionBridge({
  modalOpen,
  onConnected,
  onError,
  sessionVersion,
}: {
  modalOpen: boolean;
  onConnected: () => void;
  onError: () => void;
  sessionVersion: number;
}) {
  const { isConnected } = useAccount();
  const connectors = useConnectors();
  const { connectAsync } = useConnect();
  const bridging = React.useRef(false);

  React.useEffect(() => {
    if (IS_DETERMINISTIC_BROWSER || sessionVersion === 0) return;
    if (modalOpen || isConnected || bridging.current) return;
    bridging.current = true;
    void connectParaSession({
      connectors,
      connect: (connector) => connectAsync({ connector }),
    })
      .then((connected) => {
        if (connected) onConnected();
      })
      .catch(onError)
      .finally(() => {
        bridging.current = false;
      });
  }, [connectAsync, connectors, isConnected, modalOpen, onConnected, onError, sessionVersion]);

  return null;
}

export function AppSpecificProviders({ children }: { children: React.ReactNode }) {
  // Per render tree, never module scope: on the server one shared client would
  // hand one visitor's fetched data to the next request.
  const [queryClient] = React.useState(createQueryClient);

  // Last session's values are, by definition, values the server did not render, and
  // streamed segments keep hydrating after this effect fires. Seeding the cache before
  // the document settles re-renders a tree React is still matching against the server's
  // HTML, which it reports as a hydration failure. Restore once the document is done.
  React.useEffect(() => {
    let teardown: (() => void) | undefined;
    const restore = () => {
      teardown = installQueryPersistence(queryClient);
    };
    if (document.readyState === "complete") restore();
    else window.addEventListener("load", restore, { once: true });
    return () => {
      window.removeEventListener("load", restore);
      teardown?.();
    };
  }, [queryClient]);
  const [paraHostLoaded, setParaHostLoaded] = React.useState(false);
  const [paraRequestId, setParaRequestId] = React.useState(0);
  const [paraRequest, setParaRequest] = React.useState<ParaRequest>({ kind: "auth" });
  const [paraModalOpen, setParaModalOpen] = React.useState(false);
  const [paraSessionVersion, setParaSessionVersion] = React.useState(0);
  // Held here so it survives the shell handing over to the real sheet: those
  // are two components either side of a Suspense boundary, and anything typed
  // during the wait would otherwise go with the first one.
  const [signInEntry, setSignInEntry] = React.useState("");
  const [paraConnectionError, setParaConnectionError] = React.useState(false);

  // Bring Para up in the background once the page is done and the browser is
  // idle. It mounts closed and invisible, so by the time anyone clicks Sign
  // in both the chunk and Para's own async init are already finished and the
  // sheet opens with nothing to wait for.
  //
  // Skipped on metered or slow connections: this is ~725 KiB that a visitor
  // who never signs in does not need, and on those links the preload would
  // cost more than the wait it saves. They still get it on click.
  React.useEffect(() => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    const link = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (link?.saveData) return;
    if (link?.effectiveType && /(^|-)2g$/.test(link.effectiveType)) return;

    let cancelled = false;
    const warm = () => {
      if (!cancelled) setParaHostLoaded(true);
    };
    const idle = (
      window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const schedule = () => (idle ? idle(warm, { timeout: 4000 }) : window.setTimeout(warm, 1500));

    let handle: number | undefined;
    if (document.readyState === "complete") handle = schedule();
    else window.addEventListener("load", () => (handle = schedule()), { once: true });
    return () => {
      cancelled = true;
      if (handle !== undefined) window.clearTimeout(handle);
    };
  }, []);

  // Preserve embedded-wallet sessions without penalizing anonymous visitors.
  // Para's own session is authoritative; transient verification failures keep
  // the local marker intact so a later page load can recover.
  React.useEffect(() => {
    if (PARA_EMBEDDED_WALLET_ENABLED) void verifyMarkedParaSession();
  }, []);

  const requestSignIn = React.useCallback(() => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    setParaConnectionError(false);
    setParaHostLoaded(true);
    setParaRequest({ kind: "auth" });
    setParaRequestId((current) => current + 1);
  }, []);
  const requestAddFunds = React.useCallback((request: ParaAddFundsRequest) => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    setParaConnectionError(false);
    setParaHostLoaded(true);
    setParaRequest({ kind: "addFunds", ...request });
    setParaRequestId((current) => current + 1);
  }, []);
  const markParaSettled = React.useCallback(
    () => setParaSessionVersion((current) => current + 1),
    [],
  );
  const clearParaConnectionError = React.useCallback(() => setParaConnectionError(false), []);
  const showParaConnectionError = React.useCallback(() => setParaConnectionError(true), []);
  const retryParaConnection = React.useCallback(() => {
    setParaConnectionError(false);
    setParaSessionVersion((current) => current + 1);
  }, []);
  const paraAuth = React.useMemo(
    () => ({
      enabled: PARA_EMBEDDED_WALLET_ENABLED,
      modalOpen: paraModalOpen,
      sessionVersion: paraSessionVersion,
      requestSignIn,
      requestAddFunds,
    }),
    [paraModalOpen, paraSessionVersion, requestSignIn, requestAddFunds],
  );

  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <ParaAuthContext.Provider value={paraAuth}>
          <ParaConnectionBridge
            modalOpen={paraModalOpen}
            onConnected={clearParaConnectionError}
            onError={showParaConnectionError}
            sessionVersion={paraSessionVersion}
          />
          <TooltipProvider delayDuration={200} skipDelayDuration={100}>
            <TransactionReviewProvider>{children}</TransactionReviewProvider>
          </TooltipProvider>
          {paraConnectionError ? (
            <ParaConnectionNotice
              onDismiss={clearParaConnectionError}
              onRetry={retryParaConnection}
            />
          ) : null}
          {paraHostLoaded ? (
            <React.Suspense
              fallback={
                paraRequest.kind === "auth" && paraRequestId > 0 ? (
                  <SignInPlaceholder entry={signInEntry} onEntryChange={setSignInEntry} />
                ) : null
              }
            >
              <ParaModalHost
                requestId={paraRequestId}
                request={paraRequest}
                onOpenChange={setParaModalOpen}
                onSettled={markParaSettled}
                entry={signInEntry}
                onEntryChange={setSignInEntry}
              />
            </React.Suspense>
          ) : null}
        </ParaAuthContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
