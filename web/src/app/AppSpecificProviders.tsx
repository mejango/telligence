"use client";

import { TransactionReviewProvider } from "@/components/TransactionReviewProvider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IS_DETERMINISTIC_BROWSER, PARA_EMBEDDED_WALLET_ENABLED } from "@/lib/browserEnvironment";
import { installQueryPersistence } from "@/lib/query-persist";
import { watchSafeWalletPeer } from "@/lib/safe-connector";
import { transactionActivitySnapshot, useTransactionActivities } from "@/lib/transaction-activity";
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
const HeldRowFollowers = React.lazy(() =>
  import("@/components/HeldRowFollowers").then((module) => ({ default: module.HeldRowFollowers })),
);

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

  // Let the document load before restoring last session's display values. Each
  // consumer still needs its own hydration snapshot: streamed Suspense children
  // can hydrate after window load, and the server did not render these values.
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

  // Safe{Wallet} over WalletConnect is a Safe, and only its live session says so.
  React.useEffect(() => watchSafeWalletPeer(wagmiConfig), []);

  // Every page load follows the paid Relayr bundles and Safe proposals the
  // transaction journal still has in flight (HeldRowFollowers follows held proposals).
  // The journal is empty for most visitors, so the write machinery loads only for one
  // that has rows.
  React.useEffect(() => {
    if (transactionActivitySnapshot().length === 0) return;
    void import("@/hooks/useReviewedRelayr").then((module) => module.resumePendingRelayrBundles());
    void import("@/lib/held-rows").then((module) => module.resumeSafeProposalTracking(wagmiConfig));
  }, []);
  const journaled = useTransactionActivities().length > 0;

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

  // Preserve embedded-wallet sessions without penalizing anonymous visitors.
  // Para's own session is authoritative; transient verification failures keep
  // the local marker intact so a later page load can recover.
  React.useEffect(() => {
    if (PARA_EMBEDDED_WALLET_ENABLED) void verifyMarkedParaSession();
  }, []);

  const paraReturnFocus = React.useRef<HTMLElement | null>(null);
  const requestSignIn = React.useCallback(() => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    paraReturnFocus.current = document.activeElement as HTMLElement | null;
    setParaConnectionError(false);
    setParaHostLoaded(true);
    setParaRequest({ kind: "auth" });
    setParaRequestId((current) => current + 1);
  }, []);
  const requestAddFunds = React.useCallback((request: ParaAddFundsRequest) => {
    if (!PARA_EMBEDDED_WALLET_ENABLED) return;
    paraReturnFocus.current = document.activeElement as HTMLElement | null;
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
          {journaled ? (
            <React.Suspense fallback={null}>
              <HeldRowFollowers />
            </React.Suspense>
          ) : null}
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
                returnFocus={paraReturnFocus}
              />
            </React.Suspense>
          ) : null}
        </ParaAuthContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
